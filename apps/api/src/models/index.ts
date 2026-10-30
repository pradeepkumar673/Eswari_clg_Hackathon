import mongoose from 'mongoose';
import { logger } from '../logger.js';

// Core
export * from './users.js';
export * from './suppliers.js';
export * from './warehouses.js';
export * from './skus.js';
export * from './supplier-skus.js';
export * from './transfer-lanes.js';
export * from './shipments.js';
export * from './shipment-lines.js';
export * from './inventory-balances.js';
export * from './orders.js';
export * from './order-lines.js';

// Events & Intelligence
export * from './source-trust.js';
export * from './shipment-events.js';
export * from './field-reports.js';
export * from './import-batches.js';
export * from './import-rows.js';
export * from './disruptions.js';
export * from './order-risk-snapshots.js';
export * from './llm-cache.js';

// Recovery & Governance
export * from './recovery-plans.js';
export * from './plan-actions.js';
export * from './plan-claims.js';
export * from './stock-reservations.js';
export * from './approvals.js';
export * from './execution-ledger.js';
export * from './audit-logs.js';
export * from './notifications.js';

// Add-ons
export * from './route-options.js';
export * from './plan-tradeoffs.js';
export * from './allocation-conflicts.js';
export * from './allocation-claims.js';
export * from './order-promise-dates.js';
export * from './lineage-edges.js';
export * from './historical-cases.js';
export * from './fingerprints.js';
export * from './disruption-fingerprints.js';
export * from './guardrail-policies.js';
export * from './guardrail-checks.js';
export * from './spof-snapshots.js';
export * from './stress-runs.js';

// Micro-features
export * from './alerts.js';
export * from './stock-thresholds.js';
export * from './risk-policies.js';
export * from './supplier-scorecards.js';
export * from './approval-delegations.js';
export * from './simulation-runs.js';
export * from './customer-notices.js';
export * from './settings.js';
export * from './chain-state.js';

// Step 19 Extensions
export * from './cctv-clips.js';
export * from './cctv-events.js';
export * from './evidence-items.js';
export * from './supplier-claims.js';
export * from './driver-pings.js';
export * from './driver-incidents.js';
export * from './reroute-proposals.js';
export * from './zones.js';
export * from './zone-stock-assignments.js';
export * from './inbound-slot-plans.js';
export * from './damage-policies.js';

// Import references for ensureIndexes
import { User } from './users.js';
import { Supplier } from './suppliers.js';
import { Warehouse } from './warehouses.js';
import { Sku } from './skus.js';
import { SupplierSku } from './supplier-skus.js';
import { TransferLane } from './transfer-lanes.js';
import { Shipment } from './shipments.js';
import { ShipmentLine } from './shipment-lines.js';
import { InventoryBalance } from './inventory-balances.js';
import { Order } from './orders.js';
import { OrderLine } from './order-lines.js';

import { SourceTrust } from './source-trust.js';
import { ShipmentEvent } from './shipment-events.js';
import { FieldReport } from './field-reports.js';
import { ImportBatch } from './import-batches.js';
import { ImportRow } from './import-rows.js';
import { Disruption } from './disruptions.js';
import { OrderRiskSnapshot } from './order-risk-snapshots.js';
import { LLMCache } from './llm-cache.js';

import { RecoveryPlan } from './recovery-plans.js';
import { PlanAction } from './plan-actions.js';
import { PlanClaim } from './plan-claims.js';
import { StockReservation } from './stock-reservations.js';
import { Approval } from './approvals.js';
import { ExecutionLedger } from './execution-ledger.js';
import { AuditLog } from './audit-logs.js';
import { Notification } from './notifications.js';

import { RouteOption } from './route-options.js';
import { PlanTradeoff } from './plan-tradeoffs.js';
import { AllocationConflict } from './allocation-conflicts.js';
import { AllocationClaim } from './allocation-claims.js';
import { OrderPromiseDate } from './order-promise-dates.js';
import { LineageEdge } from './lineage-edges.js';
import { HistoricalCase } from './historical-cases.js';
import { Fingerprint } from './fingerprints.js';
import { DisruptionFingerprint } from './disruption-fingerprints.js';
import { GuardrailPolicy } from './guardrail-policies.js';
import { GuardrailCheck } from './guardrail-checks.js';
import { SPOFSnapshot } from './spof-snapshots.js';
import { StressRun } from './stress-runs.js';

import { Alert } from './alerts.js';
import { StockThreshold } from './stock-thresholds.js';
import { RiskPolicy } from './risk-policies.js';
import { SupplierScorecard } from './supplier-scorecards.js';
import { ApprovalDelegation } from './approval-delegations.js';
import { SimulationRun } from './simulation-runs.js';
import { CustomerNotice } from './customer-notices.js';
import { Setting } from './settings.js';
import { ChainState } from './chain-state.js';

import { CctvClip } from './cctv-clips.js';
import { CctvEvent } from './cctv-events.js';
import { EvidenceItem } from './evidence-items.js';
import { SupplierClaim } from './supplier-claims.js';
import { DriverPing } from './driver-pings.js';
import { DriverIncident } from './driver-incidents.js';
import { RerouteProposal } from './reroute-proposals.js';
import { Zone } from './zones.js';
import { ZoneStockAssignment } from './zone-stock-assignments.js';
import { InboundSlotPlan } from './inbound-slot-plans.js';
import { DamagePolicy } from './damage-policies.js';

const ALL_MODELS = [
  User,
  Supplier,
  Warehouse,
  Sku,
  SupplierSku,
  TransferLane,
  Shipment,
  ShipmentLine,
  InventoryBalance,
  Order,
  OrderLine,
  SourceTrust,
  ShipmentEvent,
  FieldReport,
  ImportBatch,
  ImportRow,
  Disruption,
  OrderRiskSnapshot,
  LLMCache,
  RecoveryPlan,
  PlanAction,
  PlanClaim,
  StockReservation,
  Approval,
  ExecutionLedger,
  AuditLog,
  Notification,
  RouteOption,
  PlanTradeoff,
  AllocationConflict,
  AllocationClaim,
  OrderPromiseDate,
  LineageEdge,
  HistoricalCase,
  Fingerprint,
  DisruptionFingerprint,
  GuardrailPolicy,
  GuardrailCheck,
  SPOFSnapshot,
  StressRun,
  Alert,
  StockThreshold,
  RiskPolicy,
  SupplierScorecard,
  ApprovalDelegation,
  SimulationRun,
  CustomerNotice,
  Setting,
  ChainState,
  // Step 19
  CctvClip,
  CctvEvent,
  EvidenceItem,
  SupplierClaim,
  DriverPing,
  DriverIncident,
  RerouteProposal,
  Zone,
  ZoneStockAssignment,
  InboundSlotPlan,
  DamagePolicy,
];

/**
 * Ensures all collection indexes and schema validators exist in MongoDB.
 * Called during server startup and test setup.
 */
export async function ensureIndexes(dbInstance?: mongoose.mongo.Db): Promise<void> {
  const db = dbInstance || mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection is not ready for ensureIndexes()');
  }

  // 1. Create all model indexes
  for (const model of ALL_MODELS) {
    try {
      if (model.modelName === 'InboundSlotPlan') {
        const existingIndexes = await db.collection('inbound_slot_plans').indexes().catch(() => []);
        const oldIdx = existingIndexes.find((idx: any) => idx.name === 'shipment_id_1' && !idx.unique);
        if (oldIdx) {
          await db.collection('inbound_slot_plans').dropIndex('shipment_id_1').catch(() => {});
        }
      }
      await model.createIndexes();
    } catch (err: any) {
      logger.warn({ model: model.modelName, err: err.message }, 'createIndexes warning');
    }
  }

  // 2. Enforce collection validator on inventory_balances: reserved >= 0 AND reserved <= on_hand
  const invValidator = {
    $expr: {
      $and: [
        { $gte: ['$reserved', 0] },
        { $gte: ['$on_hand', 0] },
        { $lte: ['$reserved', '$on_hand'] },
      ],
    },
  };

  try {
    const collections = await db.listCollections({ name: 'inventory_balances' }).toArray();
    if (collections.length === 0) {
      await db.createCollection('inventory_balances', {
        validator: invValidator,
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await db.command({
        collMod: 'inventory_balances',
        validator: invValidator,
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to set inventory_balances collection validator');
  }

  // 3. Enforce collection validator on zones: reserved_inbound_slots >= 0 AND reserved_inbound_slots <= capacity_slots
  const zoneValidator = {
    $expr: {
      $and: [
        { $gte: ['$reserved_inbound_slots', 0] },
        { $gte: ['$capacity_slots', 0] },
        { $lte: ['$reserved_inbound_slots', '$capacity_slots'] },
      ],
    },
  };

  try {
    const zoneCols = await db.listCollections({ name: 'zones' }).toArray();
    if (zoneCols.length === 0) {
      await db.createCollection('zones', {
        validator: zoneValidator,
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await db.command({
        collMod: 'zones',
        validator: zoneValidator,
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to set zones collection validator');
  }
}
