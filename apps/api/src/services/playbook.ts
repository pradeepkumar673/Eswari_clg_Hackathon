/**
 * apps/api/src/services/playbook.ts
 *
 * Step 11 Part A – Playbook memory (A6).
 *
 * Similarity scoring formula:
 *   0.35 same disruption_type
 *   0.25 same supplier or warehouse
 *   0.20 same SKU overlap
 *   0.20 (1 - |shortage_ratio_difference|)
 *
 * Stores LIVE historical_cases rows after each disruption is closed.
 */

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { HistoricalCase } from '../models/historical-cases.js';
import { Fingerprint } from '../models/fingerprints.js';
import { DisruptionFingerprint } from '../models/disruption-fingerprints.js';
import { Disruption } from '../models/disruptions.js';
import { Shipment } from '../models/shipments.js';
import { ShipmentLine } from '../models/shipment-lines.js';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { ExecutionLedger } from '../models/execution-ledger.js';
import { writeAudit } from './audit.js';
import { simClock } from './simClock.js';

// ---------------------------------------------------------------------------
// Fingerprint key derivation (A10 helper)
// ---------------------------------------------------------------------------

export function computeFingerprintCode(
  disruption_type: string,
  severity: string,
  sku_ids: string[],
  warehouse_ids: string[],
): string {
  const sortedSkus = [...sku_ids].sort().join(',');
  const sortedWhs = [...warehouse_ids].sort().join(',');
  const raw = `${disruption_type}|${severity}|${sortedSkus}|${sortedWhs}`;
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

// ---------------------------------------------------------------------------
// Similarity computation (A6)
// ---------------------------------------------------------------------------

interface CaseContext {
  disruption_type: string;
  supplier_id?: string | null;
  warehouse_id?: string | null;
  sku_ids: string[];
  shortage_ratio: number;
}

function computeSimilarity(a: CaseContext, b: CaseContext): number {
  let score = 0;

  // 0.35 same disruption type
  if (a.disruption_type === b.disruption_type) score += 0.35;

  // 0.25 same supplier or warehouse
  if (
    (a.supplier_id && b.supplier_id && a.supplier_id === b.supplier_id) ||
    (a.warehouse_id && b.warehouse_id && a.warehouse_id === b.warehouse_id)
  ) {
    score += 0.25;
  }

  // 0.20 SKU overlap (Jaccard)
  const setA = new Set(a.sku_ids);
  const setB = new Set(b.sku_ids);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  if (union > 0) score += 0.20 * (intersection / union);

  // 0.20 shortage ratio proximity
  const ratioDiff = Math.abs(a.shortage_ratio - b.shortage_ratio);
  score += 0.20 * (1 - Math.min(ratioDiff, 1));

  return Math.round(score * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Get similar cases for a disruption (GET /disruptions/:id/playbook)
// ---------------------------------------------------------------------------

export async function getSimilarCases(
  disruptionId: string,
): Promise<{ cases: any[]; method: 'rule-based' }> {
  const disruption = await Disruption.findById(disruptionId).lean();
  if (!disruption) return { cases: [], method: 'rule-based' };

  const shipment = await Shipment.findById(disruption.shipment_id).lean();
  const lines = await ShipmentLine.find({ shipment_id: disruption.shipment_id }).lean();
  const skuIds = lines.map((l) => l.sku_id.toString());

  const queryCtx: CaseContext = {
    disruption_type: disruption.disruption_type,
    supplier_id: shipment?.supplier_id.toString(),
    warehouse_id: shipment?.warehouse_id.toString(),
    sku_ids: skuIds,
    shortage_ratio:
      disruption.original_quantity > 0
        ? (disruption.original_quantity - disruption.usable_quantity) / disruption.original_quantity
        : 0,
  };

  // Load all historical cases
  const cases = await HistoricalCase.find({}).lean();

  const scored = cases
    .map((c: any) => {
      const ctx: CaseContext = {
        disruption_type: c.disruption_type,
        supplier_id: c.supplier_id,
        warehouse_id: c.warehouse_id,
        sku_ids: c.sku_ids || [],
        shortage_ratio: c.shortage_ratio || 0,
      };
      const similarity = computeSimilarity(queryCtx, ctx);
      const insight = buildInsightText(c);
      return {
        case_id: c._id,
        similarity,
        insight,
        disruption_type: c.disruption_type,
        strategy_used: c.strategy_used,
        outcome: c.outcome,
        cost: c.cost,
        resolution_hours: c.resolution_hours,
        what_tried: c.what_tried,
        what_worked: c.what_worked,
        what_failed: c.what_failed,
        why: c.why,
        created_at: c.created_at,
      };
    })
    .sort((a: any, b: any) => b.similarity - a.similarity)
    .slice(0, 3);

  return { cases: scored, method: 'rule-based' };
}

function buildInsightText(c: any): string {
  const outcome = c.outcome === 'SUCCESS' ? 'resolved successfully' : 'resolved with partial/no recovery';
  return (
    `A similar ${c.disruption_type} disruption ${outcome} using "${c.strategy_used}". ` +
    `Resolution took ${c.resolution_hours}h at cost ₹${c.cost}. ` +
    `Late orders: ${c.late_orders || 0}.`
  );
}

// ---------------------------------------------------------------------------
// Close disruption and write historical_cases row (POST /disruptions/:id/close)
// ---------------------------------------------------------------------------

export async function closeDisruptionAndSaveCase(
  disruptionId: string,
  actorId: mongoose.Types.ObjectId,
  options?: { no_action?: boolean; reason?: string },
): Promise<any> {
  const disruption = await Disruption.findById(disruptionId);
  if (!disruption) {
    const error: any = new Error('Disruption not found');
    error.statusCode = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (disruption.status === 'RESOLVED') {
    const error: any = new Error('Disruption already resolved');
    error.statusCode = 409;
    error.code = 'ALREADY_RESOLVED';
    throw error;
  }

  // Find executed plan for this disruption
  const executedPlan = await RecoveryPlan.findOne({
    disruption_id: disruption._id,
    status: { $in: ['EXECUTED', 'COMPLETED'] },
  }).lean();

  if (!executedPlan && !options?.no_action) {
    const error: any = new Error(
      'Disruption requires an EXECUTED recovery plan, or explicit no_action=true to close',
    );
    error.statusCode = 409;
    error.code = 'PLAN_NOT_EXECUTED';
    throw error;
  }

  const now = await simClock.now();
  const shipment = await Shipment.findById(disruption.shipment_id).lean();
  const lines = await ShipmentLine.find({ shipment_id: disruption.shipment_id }).lean();
  const skuIds = lines.map((l) => l.sku_id.toString());

  // Compute real freight cost from ledger
  let freightCost = 0;
  let lateOrders = 0;
  let whatTried = options?.no_action ? 'No action taken' : 'Recovery plan execution';
  let whatWorked = options?.no_action ? 'None' : 'Reallocation and expedites completed';
  let whatFailed = 'None';
  let why = options?.reason || (options?.no_action ? 'Explicitly marked no-action' : 'Normal resolution via recovery plan');

  if (executedPlan) {
    const ledgerRows = await ExecutionLedger.find({ plan_id: executedPlan._id }).lean();
    freightCost = (executedPlan as any).total_cost || 0;
    lateOrders = ledgerRows.filter((r) => (r as any).step_type === 'EXPEDITE').length;
    whatTried = `Strategy: ${(executedPlan as any).strategy}`;
    whatWorked = `Ledger actions executed: ${ledgerRows.length}`;
  }

  const resolutionHours = Math.round(
    ((now.getTime() - disruption.detected_at.getTime()) / 3_600_000) * 10,
  ) / 10;

  const shortageRatio =
    disruption.original_quantity > 0
      ? (disruption.original_quantity - disruption.usable_quantity) / disruption.original_quantity
      : 0;

  // Compute/upsert fingerprint
  const fpCode = computeFingerprintCode(
    disruption.disruption_type,
    disruption.severity,
    skuIds,
    shipment ? [shipment.warehouse_id.toString()] : [],
  );

  const fp = await Fingerprint.findOneAndUpdate(
    { code: fpCode },
    {
      $set: {
        pattern: {
          disruption_type: disruption.disruption_type,
          severity: disruption.severity,
          sku_ids: skuIds,
          warehouse_ids: shipment ? [shipment.warehouse_id.toString()] : [],
        },
        last_seen_at: now,
      },
      $inc: { occurrence_count: 1 },
    },
    { upsert: true, new: true },
  );

  // Write disruption_fingerprints link
  await DisruptionFingerprint.findOneAndUpdate(
    { disruption_id: disruption._id },
    { fingerprint_id: fp._id, similarity_score: 1.0 },
    { upsert: true, new: true },
  );

  // Write LIVE historical case
  const histCase = await HistoricalCase.create({
    fingerprint_id: fp._id,
    disruption_type: disruption.disruption_type,
    strategy_used: executedPlan ? (executedPlan as any).strategy : 'NO_ACTION',
    outcome: executedPlan ? 'SUCCESS' : 'NO_ACTION',
    cost: freightCost,
    resolution_hours: resolutionHours,
    supplier_id: shipment?.supplier_id.toString() || null,
    warehouse_id: shipment?.warehouse_id.toString() || null,
    sku_ids: skuIds,
    shortage_ratio: shortageRatio,
    late_orders: lateOrders,
    what_tried: whatTried,
    what_worked: whatWorked,
    what_failed: whatFailed,
    why: why,
    is_seeded: false,
    created_at: now,
  });

  // Mark disruption RESOLVED
  const beforeStatus = disruption.status;
  disruption.status = 'RESOLVED';
  disruption.resolved_at = now;
  await disruption.save();

  // Audit log
  await writeAudit({
    actor: actorId,
    action: 'DISRUPTION_CLOSED',
    entityType: 'Disruption',
    entityId: disruption._id.toString(),
    before: { status: beforeStatus },
    after: {
      status: 'RESOLVED',
      resolved_at: now,
      historical_case_id: histCase._id.toString(),
      resolution_hours: resolutionHours,
    },
  });

  return {
    disruption_id: disruption._id,
    status: 'RESOLVED',
    historical_case_id: histCase._id,
    fingerprint_code: fpCode,
    resolution_hours: resolutionHours,
    strategy_used: executedPlan ? (executedPlan as any).strategy : 'NO_ACTION',
  };
}
