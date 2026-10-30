/**
 * apps/api/src/services/scorecards.ts
 *
 * Step 11 Part A – Supplier Scorecards (B8).
 *
 * On-time rate = delivered shipments where actual_arrival_at <= promised_eta + grace
 *                over all delivered shipments (hidden when < 3 closed shipments).
 * Average delay hours from closed delayed shipments.
 * Recomputed on every relevant event and import.
 */

import mongoose from 'mongoose';
import { Shipment } from '../models/shipments.js';
import { SupplierScorecard } from '../models/supplier-scorecards.js';
import { Supplier } from '../models/suppliers.js';
import { Disruption } from '../models/disruptions.js';

const GRACE_HOURS = 2; // 2-hour grace for on-time determination
const MIN_CLOSED_SHIPMENTS = 3;

// ---------------------------------------------------------------------------
// Recompute scorecard for one supplier
// ---------------------------------------------------------------------------

export async function recomputeScorecard(supplierId: string | mongoose.Types.ObjectId): Promise<void> {
  const sid = new mongoose.Types.ObjectId(supplierId);

  const deliveredShipments = await Shipment.find({
    supplier_id: sid,
    status: 'DELIVERED',
    actual_arrival_at: { $ne: null },
  }).lean();

  const total = deliveredShipments.length;

  if (total < MIN_CLOSED_SHIPMENTS) {
    // Keep scorecard but mark as hidden
    await SupplierScorecard.findOneAndUpdate(
      { supplier_id: sid },
      {
        $set: {
          supplier_id: sid,
          on_time_rate: 0,
          quality_score: 0,
          total_shipments: total,
          late_shipments: 0,
          avg_delay_hours: 0,
          last_calculated_at: new Date(),
          hidden: true,
          hidden_reason: `Only ${total} closed shipments (minimum ${MIN_CLOSED_SHIPMENTS} required)`,
        },
      },
      { upsert: true, new: true },
    );
    return;
  }

  const graceMsec = GRACE_HOURS * 3_600_000;
  let onTimeCount = 0;
  let totalDelayHours = 0;
  let lateCount = 0;

  for (const s of deliveredShipments) {
    const arrival = s.actual_arrival_at!.getTime();
    const deadline = s.promised_eta.getTime() + graceMsec;
    if (arrival <= deadline) {
      onTimeCount++;
    } else {
      lateCount++;
      totalDelayHours += (arrival - deadline) / 3_600_000;
    }
  }

  const onTimeRate = onTimeCount / total;
  const avgDelayHours = lateCount > 0 ? totalDelayHours / lateCount : 0;

  // Count open disruptions for this supplier
  const openDisruptions = await Disruption.countDocuments({
    status: { $in: ['OPEN', 'IN_RECOVERY'] },
    shipment_id: {
      $in: (
        await Shipment.find({ supplier_id: sid }).distinct('_id')
      ),
    },
  });

  await SupplierScorecard.findOneAndUpdate(
    { supplier_id: sid },
    {
      $set: {
        supplier_id: sid,
        on_time_rate: Math.round(onTimeRate * 10000) / 10000,
        quality_score: Math.round(onTimeRate * 10000) / 10000,
        total_shipments: total,
        late_shipments: lateCount,
        avg_delay_hours: Math.round(avgDelayHours * 10) / 10,
        last_calculated_at: new Date(),
        hidden: false,
        hidden_reason: null,
        open_disruptions: openDisruptions,
      },
    },
    { upsert: true, new: true },
  );
}

// ---------------------------------------------------------------------------
// Recompute scorecards for all suppliers
// ---------------------------------------------------------------------------

export async function recomputeAllScorecards(): Promise<void> {
  const suppliers = await Supplier.find({}).lean();
  await Promise.all(suppliers.map((s) => recomputeScorecard(s._id.toString())));
}

// ---------------------------------------------------------------------------
// Fetch ranked scorecards for GET /suppliers/scorecards
// ---------------------------------------------------------------------------

export async function getRankedScorecards(): Promise<{ scorecards: any[]; method: 'rule-based' }> {
  const suppliers = await Supplier.find({}).lean();

  const rows = await Promise.all(
    suppliers.map(async (sup) => {
      const sc = await SupplierScorecard.findOne({ supplier_id: sup._id }).lean();
      if (!sc) {
        return {
          supplier_id: sup._id,
          supplier_name: (sup as any).name,
          on_time_rate: null,
          avg_delay_hours: null,
          total_shipments: 0,
          late_shipments: 0,
          open_disruptions: 0,
          hidden: true,
          hidden_reason: 'No scorecard computed yet',
        };
      }
      return {
        supplier_id: sc.supplier_id,
        supplier_name: (sup as any).name,
        on_time_rate: (sc as any).hidden ? null : sc.on_time_rate,
        avg_delay_hours: (sc as any).hidden ? null : sc.avg_delay_hours,
        total_shipments: sc.total_shipments,
        late_shipments: sc.late_shipments,
        open_disruptions: (sc as any).open_disruptions || 0,
        hidden: (sc as any).hidden || false,
        hidden_reason: (sc as any).hidden ? (sc as any).hidden_reason : null,
        last_calculated_at: sc.last_calculated_at,
      };
    }),
  );

  // Rank: hidden at bottom, then by on_time_rate asc (worst first), then avg_delay_hours desc
  const ranked = rows.sort((a, b) => {
    if (a.hidden && !b.hidden) return 1;
    if (!a.hidden && b.hidden) return -1;
    if (a.on_time_rate !== null && b.on_time_rate !== null) {
      return a.on_time_rate - b.on_time_rate; // lower first (worst)
    }
    return 0;
  });

  return { scorecards: ranked, method: 'rule-based' };
}

