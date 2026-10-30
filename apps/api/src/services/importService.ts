/**
 * apps/api/src/services/importService.ts
 *
 * Core service for the import pipeline (M1, B11):
 * - Batch creation with SHA-256 deduplication (FILE_ALREADY_IMPORTED)
 * - Row validation, quarantine, repair, discard
 * - Transactional commit of VALID and REPAIRED rows (governed inventory corrections)
 * - Quality reports and domain bus notification (IMPORT_COMMITTED)
 */

import mongoose from 'mongoose';
import { ImportBatch, IImportBatch } from '../models/import-batches.js';
import { ImportRow, IImportRow } from '../models/import-rows.js';
import { Warehouse } from '../models/warehouses.js';
import { Supplier } from '../models/suppliers.js';
import { Sku } from '../models/skus.js';
import { Shipment } from '../models/shipments.js';
import { ShipmentLine } from '../models/shipment-lines.js';
import { Order } from '../models/orders.js';
import { OrderLine } from '../models/order-lines.js';
import { SupplierSku } from '../models/supplier-skus.js';
import { TransferLane } from '../models/transfer-lanes.js';
import { withTransaction } from '../db/withTransaction.js';
import { parseImportBuffer } from './importParser.js';
import {
  loadReferenceCodes,
  validateBatchRows,
  validateSingleRow,
} from './importValidation.js';
import { applyInventoryCorrection } from './inventoryCorrection.js';
import { writeAudit } from './audit.js';
import { publish } from './bus.js';
import { simClock } from './simClock.js';

export interface CreateImportBatchParams {
  filename: string;
  buffer: Buffer;
  entityType: string;
  uploadedBy: mongoose.Types.ObjectId | string;
}

export interface ImportBatchReport {
  batch_id: string;
  filename: string;
  file_hash: string;
  entity_type: string;
  status: string;
  created_at: Date;
  committed_at: Date | null;
  counts: {
    valid: number;
    repaired: number;
    quarantined: number;
    duplicate: number;
    conflict: number;
    discarded: number;
    total: number;
  };
  error_reasons: Array<{ reason: string; count: number }>;
}

/**
 * Creates and validates an import batch from raw file buffer.
 */
export async function createImportBatch(params: CreateImportBatchParams): Promise<{
  status: 'VALIDATED' | 'FILE_ALREADY_IMPORTED';
  batch: IImportBatch;
  report?: ImportBatchReport;
}> {
  const { fileHash, rawContent, rows: parsedRows } = parseImportBuffer(
    params.buffer,
    params.filename,
  );

  // Check if identical file was already committed
  const alreadyCommitted = await ImportBatch.findOne({
    file_hash: fileHash,
    status: 'COMMITTED',
  });

  if (alreadyCommitted) {
    return {
      status: 'FILE_ALREADY_IMPORTED',
      batch: alreadyCommitted,
    };
  }

  const refs = await loadReferenceCodes();
  const validated = validateBatchRows(params.entityType, parsedRows, refs);

  let validCount = 0;
  let quarantinedCount = 0;
  let duplicateCount = 0;
  let conflictCount = 0;

  for (const r of validated) {
    if (r.status === 'VALID') validCount++;
    else if (r.status === 'QUARANTINED') quarantinedCount++;
    else if (r.status === 'DUPLICATE') duplicateCount++;
    else if (r.status === 'CONFLICT') conflictCount++;
  }

  const errorCount = quarantinedCount + conflictCount;

  const uploadedByObjectId =
    params.uploadedBy instanceof mongoose.Types.ObjectId
      ? params.uploadedBy
      : new mongoose.Types.ObjectId(params.uploadedBy);

  const now = await simClock.now();

  const batch = await ImportBatch.create({
    filename: params.filename,
    file_hash: fileHash,
    entity_type: params.entityType,
    status: 'VALIDATED',
    uploaded_by: uploadedByObjectId,
    row_count: validated.length,
    error_count: errorCount,
    valid_count: validCount,
    repaired_count: 0,
    quarantined_count: quarantinedCount,
    duplicate_count: duplicateCount,
    conflict_count: conflictCount,
    discarded_count: 0,
    raw_content: rawContent,
    created_at: now,
    committed_at: null,
  });

  if (validated.length > 0) {
    const importRowsToInsert = validated.map((r) => ({
      batch_id: batch._id,
      row_number: r.rowNumber,
      entity_type: params.entityType,
      natural_key: r.naturalKey,
      raw_data: r.rawData,
      repaired_data: null,
      status: r.status,
      import_errors: r.errors,
      shipment_event_id: null,
    }));

    await ImportRow.insertMany(importRowsToInsert);
  }

  await writeAudit({
    action: 'IMPORT_BATCH_CREATED',
    actor: uploadedByObjectId,
    entityType: 'import_batches',
    entityId: batch._id.toString(),
    correlationId: batch._id.toString(),
    after: {
      filename: params.filename,
      file_hash: fileHash,
      row_count: validated.length,
      valid_count: validCount,
      quarantined_count: quarantinedCount,
    },
    stepType: 'IMPORT_BATCH_CREATED',
  });

  const report = await getImportReport(batch._id.toString());

  return {
    status: 'VALIDATED',
    batch,
    report,
  };
}

/**
 * Returns quarantined and conflicting rows for human review.
 */
export async function getQuarantinedRows(batchId: string): Promise<IImportRow[]> {
  return ImportRow.find({
    batch_id: new mongoose.Types.ObjectId(batchId),
    status: { $in: ['QUARANTINED', 'CONFLICT'] },
  }).sort({ row_number: 1 });
}

/**
 * Repairs or discards an individual import row.
 * Keeps raw_data untouched.
 */
export async function patchImportRow(params: {
  rowId: string;
  action: 'REPAIR' | 'DISCARD';
  repairedData?: Record<string, unknown>;
  actor: mongoose.Types.ObjectId | string;
}): Promise<IImportRow> {
  const row = await ImportRow.findById(params.rowId);
  if (!row) {
    const err = new Error('Import row not found');
    (err as any).statusCode = 404;
    throw err;
  }

  const batch = await ImportBatch.findById(row.batch_id);
  if (!batch) {
    const err = new Error('Parent import batch not found');
    (err as any).statusCode = 404;
    throw err;
  }

  if (batch.status === 'COMMITTED') {
    const err = new Error('Cannot modify rows in an already committed batch');
    (err as any).statusCode = 400;
    throw err;
  }

  const prevStatus = row.status;

  if (params.action === 'DISCARD') {
    row.status = 'DISCARDED';
    row.import_errors = [];
  } else if (params.action === 'REPAIR') {
    if (!params.repairedData) {
      const err = new Error('repairedData is required when action is REPAIR');
      (err as any).statusCode = 400;
      throw err;
    }

    const refs = await loadReferenceCodes();
    const { errors, naturalKey } = validateSingleRow(row.entity_type, params.repairedData, refs);

    if (errors.length > 0) {
      row.status = 'QUARANTINED';
      row.repaired_data = params.repairedData;
      row.import_errors = errors;
      if (naturalKey) row.natural_key = naturalKey;
    } else {
      row.status = 'REPAIRED';
      row.repaired_data = params.repairedData;
      row.import_errors = [];
      if (naturalKey) row.natural_key = naturalKey;
    }
  }

  await row.save();

  // Recalculate batch counts
  await refreshBatchCounts(batch._id as mongoose.Types.ObjectId);

  await writeAudit({
    action: `IMPORT_ROW_${params.action}`,
    actor: params.actor,
    entityType: 'import_rows',
    entityId: row._id.toString(),
    correlationId: batch._id.toString(),
    before: { status: prevStatus },
    after: { status: row.status, import_errors: row.import_errors },
    stepType: 'IMPORT_ROW_MODIFIED',
  });

  return row;
}

/**
 * Recomputes batch status summary counts from rows.
 */
async function refreshBatchCounts(batchId: mongoose.Types.ObjectId): Promise<void> {
  const counts = await ImportRow.aggregate([
    { $match: { batch_id: batchId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const map: Record<string, number> = {};
  for (const c of counts) {
    map[c._id] = c.count;
  }

  const valid = map.VALID || 0;
  const repaired = map.REPAIRED || 0;
  const quarantined = map.QUARANTINED || 0;
  const duplicate = map.DUPLICATE || 0;
  const conflict = map.CONFLICT || 0;
  const discarded = map.DISCARDED || 0;

  await ImportBatch.updateOne(
    { _id: batchId },
    {
      $set: {
        valid_count: valid,
        repaired_count: repaired,
        quarantined_count: quarantined,
        duplicate_count: duplicate,
        conflict_count: conflict,
        discarded_count: discarded,
        error_count: quarantined + conflict,
      },
    },
  );
}

/**
 * Transactionally commits VALID and REPAIRED rows into primary database collections.
 * Quarantined, duplicate, conflict, and discarded rows are ignored.
 * Idempotent: re-calling returns current commit state without re-applying.
 */
export async function commitImportBatch(params: {
  batchId: string;
  actor: mongoose.Types.ObjectId | string;
}): Promise<{ status: 'COMMITTED' | 'ALREADY_COMMITTED'; loadedCount: number; batch: IImportBatch }> {
  const batch = await ImportBatch.findById(params.batchId);
  if (!batch) {
    const err = new Error('Import batch not found');
    (err as any).statusCode = 404;
    throw err;
  }

  if (batch.status === 'COMMITTED') {
    return {
      status: 'ALREADY_COMMITTED',
      loadedCount: batch.valid_count + batch.repaired_count,
      batch,
    };
  }

  const rowsToLoad = await ImportRow.find({
    batch_id: batch._id,
    status: { $in: ['VALID', 'REPAIRED'] },
  }).sort({ row_number: 1 });

  await withTransaction(async (session) => {
    for (const row of rowsToLoad) {
      const data = (row.repaired_data || row.raw_data) as Record<string, any>;

      switch (batch.entity_type) {
        case 'shipments': {
          const sup = await Supplier.findOne({ code: String(data.supplier_code) }).session(session);
          const destWh = await Warehouse.findOne({ code: String(data.destination_warehouse_code) }).session(session);
          if (!sup || !destWh) {
            throw new Error(`Referenced supplier or warehouse not found for shipment ${data.shipment_code}`);
          }

          const shipmentCode = String(data.shipment_code || data.code);
          const promisedEta = new Date(data.promised_eta);

          // Use $set/$setOnInsert to avoid TS strict interface conflicts with raw schema fields
          await (Shipment as any).findOneAndUpdate(
            { code: shipmentCode },
            {
              $set: {
                supplier_id: sup._id,
                warehouse_id: destWh._id,
                carrier_name: data.carrier_name || 'Standard Carrier',
                promised_eta: promisedEta,
                current_eta: promisedEta,
                total_units: Number(data.quantity || data.total_units || 0),
                status: data.status || 'IN_TRANSIT',
              },
              $setOnInsert: {
                code: shipmentCode,
                usable_quantity: null,
                is_disrupted: false,
                actual_arrival_at: null,
                created_at: await simClock.now(),
              },
            },
            { upsert: true, new: true, session },
          );

          const shipment = await Shipment.findOne({ code: shipmentCode }).session(session);

          if (data.sku_code && (data.quantity !== undefined || data.expected_quantity !== undefined) && shipment) {
            const sku = await Sku.findOne({ code: String(data.sku_code) }).session(session);
            if (sku) {
              const qty = Number(data.quantity ?? data.expected_quantity);
              await ShipmentLine.findOneAndUpdate(
                { shipment_id: shipment._id, sku_id: sku._id },
                {
                  $set: {
                    expected_quantity: qty,
                    received_quantity: Number(data.received_quantity || 0),
                    damaged_quantity: Number(data.damaged_quantity || 0),
                  },
                },
                { upsert: true, session },
              );
            }
          }
          break;
        }

        case 'orders': {
          const destCode = data.destination_warehouse_code || data.fulfilment_warehouse_code;
          const wh = await Warehouse.findOne({ code: String(destCode) }).session(session);
          if (!wh) {
            throw new Error(`Warehouse ${destCode} not found for order ${data.order_code}`);
          }

          const orderCode = String(data.order_code || data.code);

          const priorityMap: Record<string, string> = {
            '1': 'CRITICAL', CRITICAL: 'CRITICAL',
            '2': 'HIGH', HIGH: 'HIGH',
            '3': 'MEDIUM', MEDIUM: 'MEDIUM',
            '4': 'LOW', '5': 'LOW', LOW: 'LOW',
          };
          const rawPriority = String(data.priority || 'MEDIUM').toUpperCase();
          const priority = priorityMap[rawPriority] || 'MEDIUM';

          await (Order as any).findOneAndUpdate(
            { code: orderCode },
            {
              $set: {
                customer_name: data.customer_name || 'Customer',
                warehouse_id: wh._id,
                due_at: data.due_at ? new Date(data.due_at) : await simClock.now(),
                priority,
                penalty_per_hour: Number(data.penalty_per_hour || data.penalty_per_day || 500),
              },
              $setOnInsert: {
                code: orderCode,
                status: data.status || 'OPEN',
                total_units: Number(data.quantity || data.total_units || 0),
                risk_score: null,
                risk_band: null,
                recovery_plan_id: null,
                created_at: await simClock.now(),
              },
            },
            { upsert: true, new: true, session },
          );

          if (data.sku_code && data.quantity !== undefined) {
            const order = await Order.findOne({ code: orderCode }).session(session);
            const sku = await Sku.findOne({ code: String(data.sku_code) }).session(session);
            if (sku && order) {
              await OrderLine.findOneAndUpdate(
                { order_id: order._id, sku_id: sku._id },
                {
                  $set: {
                    quantity: Number(data.quantity),
                    fulfilled_quantity: 0,
                  },
                },
                { upsert: true, session },
              );
            }
          }
          break;
        }

        case 'inventory': {
          const wh = await Warehouse.findOne({ code: String(data.warehouse_code) }).session(session);
          const sku = await Sku.findOne({ code: String(data.sku_code) }).session(session);
          if (!wh || !sku) {
            throw new Error(`Warehouse or SKU not found for inventory row (${data.warehouse_code}, ${data.sku_code})`);
          }

          await applyInventoryCorrection(
            {
              warehouseId: wh._id,
              skuId: sku._id,
              newOnHand: Number(data.on_hand),
              reason: `Import batch ${batch._id}`,
              actor: params.actor,
              correlationId: batch._id.toString(),
            },
            session,
          );
          break;
        }

        case 'supplier_skus': {
          const sup = await Supplier.findOne({ code: String(data.supplier_code) }).session(session);
          const sku = await Sku.findOne({ code: String(data.sku_code) }).session(session);
          if (!sup || !sku) {
            throw new Error(`Supplier or SKU not found for supplier_sku (${data.supplier_code}, ${data.sku_code})`);
          }

          await SupplierSku.findOneAndUpdate(
            { supplier_id: sup._id, sku_id: sku._id },
            {
              $set: {
                lead_time_hours: Number(data.lead_time_hours || 24),
                unit_cost_inr: Number(data.unit_cost_inr || 100),
                capacity: Number(data.capacity || 100),
                is_qualified: String(data.is_qualified).toLowerCase() !== 'false',
              },
            },
            { upsert: true, session },
          );
          break;
        }

        case 'transfer_lanes': {
          const originWh = await Warehouse.findOne({ code: String(data.origin_warehouse_code) }).session(session);
          const destWh = await Warehouse.findOne({ code: String(data.destination_warehouse_code) }).session(session);
          if (!originWh || !destWh) {
            throw new Error(`Warehouse not found for lane (${data.origin_warehouse_code} -> ${data.destination_warehouse_code})`);
          }

          await TransferLane.findOneAndUpdate(
            { origin_warehouse_id: originWh._id, destination_warehouse_id: destWh._id },
            {
              $set: {
                transit_hours: Number(data.transit_hours || 4),
                cost_per_unit_inr: Number(data.cost_per_unit_inr || 20),
                distance_km: Number(data.distance_km || 100),
              },
            },
            { upsert: true, session },
          );
          break;
        }
      }
    }

    batch.status = 'COMMITTED';
    batch.committed_at = await simClock.now();
    await batch.save({ session });

    await writeAudit(
      {
        action: 'IMPORT_BATCH_COMMITTED',
        actor: params.actor,
        entityType: 'import_batches',
        entityId: batch._id.toString(),
        correlationId: batch._id.toString(),
        after: {
          loaded_count: rowsToLoad.length,
          entity_type: batch.entity_type,
        },
        stepType: 'IMPORT_BATCH_COMMITTED',
      },
      session,
    );
  });

  // Emit domain bus event
  await publish('IMPORT_COMMITTED', {
    batchId: batch._id.toString(),
    entityType: batch.entity_type,
    rowCount: rowsToLoad.length,
    committedBy: String(params.actor),
  });

  return {
    status: 'COMMITTED',
    loadedCount: rowsToLoad.length,
    batch,
  };
}

/**
 * Builds import quality report (B11) with counts, invariant check, and error reason histogram.
 */
export async function getImportReport(batchId: string): Promise<ImportBatchReport> {
  const batch = await ImportBatch.findById(batchId);
  if (!batch) {
    const err = new Error('Import batch not found');
    (err as any).statusCode = 404;
    throw err;
  }

  const rows = await ImportRow.find({ batch_id: batch._id }).lean();

  const counts = {
    valid: 0,
    repaired: 0,
    quarantined: 0,
    duplicate: 0,
    conflict: 0,
    discarded: 0,
    total: rows.length,
  };

  const reasonHistogram: Record<string, number> = {};

  for (const r of rows) {
    if (r.status === 'VALID') counts.valid++;
    else if (r.status === 'REPAIRED') counts.repaired++;
    else if (r.status === 'QUARANTINED') counts.quarantined++;
    else if (r.status === 'DUPLICATE') counts.duplicate++;
    else if (r.status === 'CONFLICT') counts.conflict++;
    else if (r.status === 'DISCARDED') counts.discarded++;

    if (r.import_errors && Array.isArray(r.import_errors)) {
      for (const err of r.import_errors) {
        const code = (err as any).code || 'VALIDATION_ERROR';
        reasonHistogram[code] = (reasonHistogram[code] || 0) + 1;
      }
    }
  }

  // Invariant verification: sum of states must equal total
  const sum =
    counts.valid +
    counts.repaired +
    counts.quarantined +
    counts.duplicate +
    counts.conflict +
    counts.discarded;

  if (sum !== counts.total) {
    throw new Error(`Import report counts invariant broken: sum=${sum} !== total=${counts.total}`);
  }

  const errorReasons = Object.entries(reasonHistogram).map(([reason, count]) => ({
    reason,
    count,
  }));

  return {
    batch_id: batch._id.toString(),
    filename: batch.filename,
    file_hash: batch.file_hash,
    entity_type: batch.entity_type,
    status: batch.status,
    created_at: batch.created_at,
    committed_at: batch.committed_at,
    counts,
    error_reasons: errorReasons,
  };
}



