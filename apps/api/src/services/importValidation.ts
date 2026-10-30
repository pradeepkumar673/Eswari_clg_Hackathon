/**
 * apps/api/src/services/importValidation.ts
 *
 * Entity schemas, foreign-key checks, edit-distance suggestions (B11),
 * and natural-key duplicate / conflict classification.
 */

import { z } from 'zod';
import { Supplier } from '../models/suppliers.js';
import { Warehouse } from '../models/warehouses.js';
import { Sku } from '../models/skus.js';

export interface RowValidationError {
  field?: string;
  code: string;
  message: string;
  suggestion?: string;
}

export interface ValidatedRowResult {
  rowNumber: number;
  entityType: string;
  naturalKey: string | null;
  rawData: Record<string, unknown>;
  repairedData?: Record<string, unknown> | null;
  status: 'VALID' | 'REPAIRED' | 'QUARANTINED' | 'DISCARDED' | 'DUPLICATE' | 'CONFLICT';
  errors: RowValidationError[];
}

export interface EntityReferenceCodes {
  warehouses: string[];
  suppliers: string[];
  skus: string[];
}

/**
 * Computes Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Finds the nearest valid code using edit distance.
 */
export function findNearestCode(input: string, validCodes: string[]): string | undefined {
  if (!validCodes.length || !input) return undefined;
  let bestCode: string | undefined;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const code of validCodes) {
    const dist = levenshteinDistance(input, code);
    if (dist < minDistance) {
      minDistance = dist;
      bestCode = code;
    }
  }

  // Suggest only if reasonably close (distance <= 4)
  return minDistance <= 4 ? bestCode : undefined;
}

/**
 * Loads current database codes for foreign key validation.
 */
export async function loadReferenceCodes(): Promise<EntityReferenceCodes> {
  const [warehouses, suppliers, skus] = await Promise.all([
    Warehouse.find({}, { code: 1 }).lean(),
    Supplier.find({}, { code: 1 }).lean(),
    Sku.find({}, { code: 1 }).lean(),
  ]);

  return {
    warehouses: warehouses.map((w) => w.code),
    suppliers: suppliers.map((s) => s.code),
    skus: skus.map((s) => s.code),
  };
}

/**
 * Canonical JSON serialization for comparison.
 */
function normalizeValuesForComparison(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === '_id' || k === 'id' || k === 'created_at' || k === 'updated_at') continue;
    sorted[k] = obj[k];
  }
  return JSON.stringify(sorted);
}

/**
 * Extracts natural key from row data based on entity type.
 */
export function extractNaturalKey(entityType: string, data: Record<string, unknown>): string | null {
  switch (entityType) {
    case 'shipments': {
      const code = data.shipment_code || data.code;
      return code ? String(code).trim() : null;
    }
    case 'orders': {
      const code = data.order_code || data.code;
      return code ? String(code).trim() : null;
    }
    case 'inventory': {
      const wh = data.warehouse_code;
      const sku = data.sku_code;
      return wh && sku ? `${String(wh).trim()}:${String(sku).trim()}` : null;
    }
    case 'supplier_skus': {
      const sup = data.supplier_code;
      const sku = data.sku_code;
      return sup && sku ? `${String(sup).trim()}:${String(sku).trim()}` : null;
    }
    case 'transfer_lanes': {
      const origin = data.origin_warehouse_code;
      const dest = data.destination_warehouse_code;
      return origin && dest ? `${String(origin).trim()}:${String(dest).trim()}` : null;
    }
    default:
      return null;
  }
}

/**
 * Validates a single row against schema and foreign keys.
 */
export function validateSingleRow(
  entityType: string,
  data: Record<string, unknown>,
  refs: EntityReferenceCodes,
): { errors: RowValidationError[]; naturalKey: string | null } {
  const errors: RowValidationError[] = [];
  const naturalKey = extractNaturalKey(entityType, data);

  if (!naturalKey) {
    errors.push({
      code: 'MISSING_NATURAL_KEY',
      message: `Row is missing natural key for entity type ${entityType}`,
    });
  }

  switch (entityType) {
    case 'shipments': {
      if (!data.shipment_code && !data.code) {
        errors.push({ field: 'shipment_code', code: 'REQUIRED_FIELD', message: 'shipment_code is required' });
      } else {
        const code = String(data.shipment_code || data.code);
        if (!/^SHP-[A-Za-z0-9_-]+$/i.test(code)) {
          errors.push({ field: 'shipment_code', code: 'INVALID_SHIPMENT_CODE', message: 'shipment_code must match format SHP-xxx' });
        }
      }

      if (!data.supplier_code) {
        errors.push({ field: 'supplier_code', code: 'MISSING_SUPPLIER', message: 'supplier_code is required' });
      } else {
        const sup = String(data.supplier_code);
        if (!refs.suppliers.includes(sup)) {
          errors.push({
            field: 'supplier_code',
            code: 'UNKNOWN_SUPPLIER',
            message: `Supplier "${sup}" does not exist`,
            suggestion: findNearestCode(sup, refs.suppliers),
          });
        }
      }

      const dest = data.destination_warehouse_code;
      if (!dest) {
        errors.push({ field: 'destination_warehouse_code', code: 'MISSING_WAREHOUSE', message: 'destination_warehouse_code is required' });
      } else {
        const wh = String(dest);
        if (!refs.warehouses.includes(wh)) {
          errors.push({
            field: 'destination_warehouse_code',
            code: 'UNKNOWN_WAREHOUSE',
            message: `Warehouse "${wh}" does not exist`,
            suggestion: findNearestCode(wh, refs.warehouses),
          });
        }
      }

      if (data.promised_eta) {
        const d = new Date(String(data.promised_eta));
        if (Number.isNaN(d.getTime())) {
          errors.push({ field: 'promised_eta', code: 'INVALID_DATE', message: 'promised_eta must be a valid ISO date' });
        }
      } else {
        errors.push({ field: 'promised_eta', code: 'REQUIRED_FIELD', message: 'promised_eta is required' });
      }

      // Quantity validations if present on row
      if (data.quantity !== undefined && data.quantity !== '') {
        const qty = Number(data.quantity);
        if (!Number.isInteger(qty) || qty <= 0) {
          errors.push({ field: 'quantity', code: 'NEGATIVE_OR_ZERO_QUANTITY', message: 'quantity must be a positive integer' });
        }
      }

      // SKU code validation if row defines line item
      if (data.sku_code) {
        const sku = String(data.sku_code);
        if (!refs.skus.includes(sku)) {
          errors.push({
            field: 'sku_code',
            code: 'UNKNOWN_SKU',
            message: `SKU "${sku}" does not exist`,
            suggestion: findNearestCode(sku, refs.skus),
          });
        }
      }
      break;
    }

    case 'orders': {
      if (!data.order_code && !data.code) {
        errors.push({ field: 'order_code', code: 'REQUIRED_FIELD', message: 'order_code is required' });
      }
      if (!data.customer_name) {
        errors.push({ field: 'customer_name', code: 'REQUIRED_FIELD', message: 'customer_name is required' });
      }

      const wh = data.destination_warehouse_code || data.fulfilment_warehouse_code;
      if (!wh) {
        errors.push({ field: 'destination_warehouse_code', code: 'MISSING_WAREHOUSE', message: 'destination_warehouse_code is required' });
      } else if (!refs.warehouses.includes(String(wh))) {
        errors.push({
          field: 'destination_warehouse_code',
          code: 'UNKNOWN_WAREHOUSE',
          message: `Warehouse "${wh}" does not exist`,
          suggestion: findNearestCode(String(wh), refs.warehouses),
        });
      }

      if (data.sku_code) {
        const sku = String(data.sku_code);
        if (!refs.skus.includes(sku)) {
          errors.push({
            field: 'sku_code',
            code: 'UNKNOWN_SKU',
            message: `SKU "${sku}" does not exist`,
            suggestion: findNearestCode(sku, refs.skus),
          });
        }
      }

      if (data.quantity !== undefined) {
        const qty = Number(data.quantity);
        if (!Number.isInteger(qty) || qty <= 0) {
          errors.push({ field: 'quantity', code: 'INVALID_QUANTITY', message: 'quantity must be a positive integer' });
        }
      }

      if (data.due_at) {
        const d = new Date(String(data.due_at));
        if (Number.isNaN(d.getTime())) {
          errors.push({ field: 'due_at', code: 'INVALID_DATE', message: 'due_at must be a valid ISO date' });
        }
      }
      break;
    }

    case 'inventory': {
      const wh = data.warehouse_code;
      if (!wh) {
        errors.push({ field: 'warehouse_code', code: 'MISSING_WAREHOUSE', message: 'warehouse_code is required' });
      } else if (!refs.warehouses.includes(String(wh))) {
        errors.push({
          field: 'warehouse_code',
          code: 'UNKNOWN_WAREHOUSE',
          message: `Warehouse "${wh}" does not exist`,
          suggestion: findNearestCode(String(wh), refs.warehouses),
        });
      }

      const sku = data.sku_code;
      if (!sku) {
        errors.push({ field: 'sku_code', code: 'MISSING_SKU', message: 'sku_code is required' });
      } else if (!refs.skus.includes(String(sku))) {
        errors.push({
          field: 'sku_code',
          code: 'UNKNOWN_SKU',
          message: `SKU "${sku}" does not exist`,
          suggestion: findNearestCode(String(sku), refs.skus),
        });
      }

      if (data.on_hand === undefined || data.on_hand === '') {
        errors.push({ field: 'on_hand', code: 'REQUIRED_FIELD', message: 'on_hand is required' });
      } else {
        const onHand = Number(data.on_hand);
        if (!Number.isInteger(onHand) || onHand < 0) {
          errors.push({ field: 'on_hand', code: 'INVALID_ON_HAND', message: 'on_hand must be non-negative integer' });
        }
      }
      break;
    }

    case 'supplier_skus': {
      const sup = data.supplier_code;
      if (!sup) {
        errors.push({ field: 'supplier_code', code: 'MISSING_SUPPLIER', message: 'supplier_code is required' });
      } else if (!refs.suppliers.includes(String(sup))) {
        errors.push({
          field: 'supplier_code',
          code: 'UNKNOWN_SUPPLIER',
          message: `Supplier "${sup}" does not exist`,
          suggestion: findNearestCode(String(sup), refs.suppliers),
        });
      }

      const sku = data.sku_code;
      if (!sku) {
        errors.push({ field: 'sku_code', code: 'MISSING_SKU', message: 'sku_code is required' });
      } else if (!refs.skus.includes(String(sku))) {
        errors.push({
          field: 'sku_code',
          code: 'UNKNOWN_SKU',
          message: `SKU "${sku}" does not exist`,
          suggestion: findNearestCode(String(sku), refs.skus),
        });
      }

      if (data.lead_time_hours !== undefined) {
        const lead = Number(data.lead_time_hours);
        if (!Number.isFinite(lead) || lead <= 0) {
          errors.push({ field: 'lead_time_hours', code: 'INVALID_LEAD_TIME', message: 'lead_time_hours must be positive' });
        }
      }

      if (data.unit_cost_inr !== undefined) {
        const cost = Number(data.unit_cost_inr);
        if (!Number.isInteger(cost) || cost <= 0) {
          errors.push({ field: 'unit_cost_inr', code: 'INVALID_COST', message: 'unit_cost_inr must be positive integer' });
        }
      }
      break;
    }

    case 'transfer_lanes': {
      const origin = data.origin_warehouse_code;
      if (!origin) {
        errors.push({ field: 'origin_warehouse_code', code: 'MISSING_ORIGIN', message: 'origin_warehouse_code is required' });
      } else if (!refs.warehouses.includes(String(origin))) {
        errors.push({
          field: 'origin_warehouse_code',
          code: 'UNKNOWN_WAREHOUSE',
          message: `Origin warehouse "${origin}" does not exist`,
          suggestion: findNearestCode(String(origin), refs.warehouses),
        });
      }

      const dest = data.destination_warehouse_code;
      if (!dest) {
        errors.push({ field: 'destination_warehouse_code', code: 'MISSING_DESTINATION', message: 'destination_warehouse_code is required' });
      } else if (!refs.warehouses.includes(String(dest))) {
        errors.push({
          field: 'destination_warehouse_code',
          code: 'UNKNOWN_WAREHOUSE',
          message: `Destination warehouse "${dest}" does not exist`,
          suggestion: findNearestCode(String(dest), refs.warehouses),
        });
      }

      if (origin && dest && String(origin) === String(dest)) {
        errors.push({ field: 'destination_warehouse_code', code: 'SAME_ORIGIN_DESTINATION', message: 'Origin and destination cannot be identical' });
      }
      break;
    }

    default:
      errors.push({ code: 'UNSUPPORTED_ENTITY_TYPE', message: `Unknown entity type "${entityType}"` });
  }

  return { errors, naturalKey };
}

/**
 * Validates an entire batch of raw rows, categorizing into VALID, QUARANTINED,
 * DUPLICATE, and CONFLICT according to B11 rules.
 */
export function validateBatchRows(
  entityType: string,
  rawRows: Record<string, unknown>[],
  refs: EntityReferenceCodes,
): ValidatedRowResult[] {
  const preliminary: ValidatedRowResult[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rawData = rawRows[i];
    const rowNumber = i + 1;
    const { errors, naturalKey } = validateSingleRow(entityType, rawData, refs);

    preliminary.push({
      rowNumber,
      entityType,
      naturalKey,
      rawData,
      repairedData: null,
      status: errors.length > 0 ? 'QUARANTINED' : 'VALID',
      errors,
    });
  }

  // Pass 2: Natural-key handling (B11) across rows without quarantine errors
  const keyGroups = new Map<string, ValidatedRowResult[]>();
  for (const item of preliminary) {
    if (item.status === 'VALID' && item.naturalKey) {
      if (!keyGroups.has(item.naturalKey)) {
        keyGroups.set(item.naturalKey, []);
      }
      keyGroups.get(item.naturalKey)!.push(item);
    }
  }

  for (const [naturalKey, group] of keyGroups.entries()) {
    if (group.length > 1) {
      const firstNormalized = normalizeValuesForComparison(group[0].rawData);
      let allIdentical = true;

      for (let j = 1; j < group.length; j++) {
        if (normalizeValuesForComparison(group[j].rawData) !== firstNormalized) {
          allIdentical = false;
          break;
        }
      }

      if (allIdentical) {
        // First row remains VALID, subsequent identical rows are DUPLICATE
        for (let j = 1; j < group.length; j++) {
          group[j].status = 'DUPLICATE';
          group[j].errors = [
            {
              code: 'DUPLICATE_NATURAL_KEY',
              message: `Duplicate row for natural key "${naturalKey}" with identical content`,
            },
          ];
        }
      } else {
        // Different values for same natural key -> CONFLICT for human review, apply neither!
        for (const item of group) {
          item.status = 'CONFLICT';
          item.errors = [
            {
              code: 'NATURAL_KEY_CONFLICT',
              message: `Conflicting data values found for natural key "${naturalKey}" across batch rows`,
            },
          ];
        }
      }
    }
  }

  return preliminary;
}

