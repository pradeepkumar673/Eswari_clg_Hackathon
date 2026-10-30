/**
 * apps/api/src/services/fingerprints.ts
 *
 * Step 11 Part A – Disruption Fingerprints (A10).
 *
 * Fingerprint key = (disruption_type, severity, sku_ids, warehouse_ids) → SHA-256 hex prefix.
 * Active after 3+ matching cases; new match = MATCH label; precursor event = PRE_WARNING.
 */

import { Fingerprint } from '../models/fingerprints.js';
import { DisruptionFingerprint } from '../models/disruption-fingerprints.js';
import { HistoricalCase } from '../models/historical-cases.js';
import { computeFingerprintCode } from './playbook.js';
import { Disruption } from '../models/disruptions.js';
import { Shipment } from '../models/shipments.js';
import { ShipmentLine } from '../models/shipment-lines.js';

const ACTIVE_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// List all fingerprints with match counts
// ---------------------------------------------------------------------------

export async function listFingerprints(): Promise<{ fingerprints: any[]; method: 'rule-based' }> {
  const fps = await Fingerprint.find({}).lean();

  const results = await Promise.all(
    fps.map(async (fp) => {
      const matchCount = await HistoricalCase.countDocuments({ fingerprint_id: fp._id });
      return {
        fingerprint_id: fp._id,
        code: fp.code,
        pattern: fp.pattern,
        occurrence_count: fp.occurrence_count,
        match_count: matchCount,
        active: fp.occurrence_count >= ACTIVE_THRESHOLD,
        last_seen_at: fp.last_seen_at,
      };
    }),
  );

  return { fingerprints: results, method: 'rule-based' };
}

// ---------------------------------------------------------------------------
// Get fingerprints for a specific disruption
// ---------------------------------------------------------------------------

export async function getDisruptionFingerprints(
  disruptionId: string,
): Promise<{ fingerprints: any[]; label?: string; method: 'rule-based' }> {
  const disruption = await Disruption.findById(disruptionId).lean();
  if (!disruption) return { fingerprints: [], method: 'rule-based' };

  const shipment = await Shipment.findById(disruption.shipment_id).lean();
  const lines = await ShipmentLine.find({ shipment_id: disruption.shipment_id }).lean();
  const skuIds = lines.map((l) => l.sku_id.toString());

  // Compute code for this disruption
  const fpCode = computeFingerprintCode(
    disruption.disruption_type,
    disruption.severity,
    skuIds,
    shipment ? [shipment.warehouse_id.toString()] : [],
  );

  const fp = await Fingerprint.findOne({ code: fpCode }).lean();
  if (!fp) return { fingerprints: [], method: 'rule-based' };

  const matchCount = await HistoricalCase.countDocuments({ fingerprint_id: fp._id });

  let label: string | undefined;
  if (fp.occurrence_count >= ACTIVE_THRESHOLD) {
    label = 'MATCH';
  }

  // Also check linked fingerprints from disruption_fingerprints collection
  const links = await DisruptionFingerprint.find({ disruption_id: disruptionId })
    .populate('fingerprint_id')
    .lean();

  return {
    fingerprints: [
      {
        fingerprint_id: fp._id,
        code: fp.code,
        pattern: fp.pattern,
        occurrence_count: fp.occurrence_count,
        match_count: matchCount,
        active: fp.occurrence_count >= ACTIVE_THRESHOLD,
        label: label || null,
        last_seen_at: fp.last_seen_at,
      },
      ...links
        .filter((l) => (l.fingerprint_id as any)?._id?.toString() !== fp._id.toString())
        .map((l) => ({
          fingerprint_id: (l.fingerprint_id as any)._id,
          code: (l.fingerprint_id as any).code,
          similarity_score: l.similarity_score,
        })),
    ],
    label,
    method: 'rule-based',
  };
}

// ---------------------------------------------------------------------------
// Upsert fingerprint on disruption open (call from disruption creation)
// ---------------------------------------------------------------------------

export async function recordFingerprintOnOpen(
  disruptionId: string,
  disruption_type: string,
  severity: string,
  skuIds: string[],
  warehouseIds: string[],
  now: Date,
): Promise<{ code: string; label?: string }> {
  const fpCode = computeFingerprintCode(disruption_type, severity, skuIds, warehouseIds);

  const fp = await Fingerprint.findOneAndUpdate(
    { code: fpCode },
    {
      $set: {
        pattern: { disruption_type, severity, sku_ids: skuIds, warehouse_ids: warehouseIds },
        last_seen_at: now,
      },
      $inc: { occurrence_count: 1 },
    },
    { upsert: true, new: true },
  );

  const matchCount = await HistoricalCase.countDocuments({ fingerprint_id: fp._id });

  let label: string | undefined;
  if (fp.occurrence_count >= ACTIVE_THRESHOLD) {
    label = 'MATCH';
  }

  // Link to disruption
  await DisruptionFingerprint.findOneAndUpdate(
    { disruption_id: disruptionId },
    { fingerprint_id: fp._id, similarity_score: 1.0 },
    { upsert: true, new: true },
  );

  return { code: fpCode, label };
}

