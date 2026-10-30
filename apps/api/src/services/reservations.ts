/**
 * apps/api/src/services/reservations.ts
 *
 * Double-Booking Shield and Stock Reservation Management (Step 9, S1, S2, A4).
 * Enforces atomic conditional updates on MongoDB replica set transactions.
 */

import mongoose, { ClientSession } from 'mongoose';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { PlanAction } from '../models/plan-actions.js';
import { StockReservation } from '../models/stock-reservations.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { AllocationConflict } from '../models/allocation-conflicts.js';
import { AllocationClaim } from '../models/allocation-claims.js';
import { simClock } from './simClock.js';

export interface ReserveStockResult {
  success: boolean;
  reservationIds: string[];
  conflictReason?: string;
  conflictCard?: {
    warehouse_id: string;
    sku_id: string;
    needed: number;
    free: number;
    holding_plans: string[];
  };
}

/**
 * Double-Booking Shield (S1):
 * For every needed (warehouse, sku) sorted deterministically by (warehouse_id, sku_id),
 * runs conditional update:
 *   filter: { warehouse_id, sku_id, $expr: { $gte: [{ $subtract: ["$on_hand", "$reserved"] }, qty] } }
 *   update: { $inc: { reserved: qty }, $set: { updated_at: now } }
 * If matchedCount === 0: aborts and returns 409 conflict card.
 */
export async function reserveStock(
  planId: mongoose.Types.ObjectId | string,
  session?: ClientSession,
): Promise<ReserveStockResult> {
  const pId = typeof planId === 'string' ? new mongoose.Types.ObjectId(planId) : planId;
  const plan = await RecoveryPlan.findById(pId).session(session || null);
  if (!plan) return { success: false, reservationIds: [], conflictReason: 'Plan not found' };

  // Check if this plan already has an OPEN allocation conflict
  const existingConflict = await AllocationConflict.findOne({
    status: 'OPEN',
  }).session(session || null);
  if (existingConflict) {
    const claims = await AllocationClaim.find({ conflict_id: existingConflict._id }).session(session || null);
    const isPlanInConflict = claims.some((c) => c.plan_id.toString() === pId.toString());
    if (isPlanInConflict) {
      return {
        success: false,
        reservationIds: [],
        conflictReason: 'Plan has an OPEN allocation conflict case. Resolve in Allocation Conflict Court first.',
      };
    }
  }

  const actions = await PlanAction.find({ plan_id: pId }).session(session || null);
  const now = await simClock.now();
  const expiresAt = new Date(now.getTime() + 24 * 3600 * 1000); // 24-hour hold

  // Group demand by (warehouse_id, sku_id)
  const demandMap = new Map<string, { warehouse_id: mongoose.Types.ObjectId; sku_id: mongoose.Types.ObjectId; qty: number; action_ids: mongoose.Types.ObjectId[] }>();

  for (const act of actions) {
    if (act.action_type === 'TRANSFER' && act.from_warehouse_id) {
      const key = `${act.from_warehouse_id.toString()}|${act.sku_id.toString()}`;
      if (!demandMap.has(key)) {
        demandMap.set(key, {
          warehouse_id: act.from_warehouse_id,
          sku_id: act.sku_id,
          qty: 0,
          action_ids: [],
        });
      }
      const entry = demandMap.get(key)!;
      entry.qty += act.quantity;
      entry.action_ids.push(act._id);
    }
  }

  // Sort entries deterministically by (warehouse_id, sku_id) to avoid deadlock
  const sortedDemands = Array.from(demandMap.values()).sort((a, b) => {
    const cmpWh = a.warehouse_id.toString().localeCompare(b.warehouse_id.toString());
    if (cmpWh !== 0) return cmpWh;
    return a.sku_id.toString().localeCompare(b.sku_id.toString());
  });

  const reservationIds: string[] = [];

  for (const demand of sortedDemands) {
    // Conditional update — atomicity guarantee
    const updateRes = await InventoryBalance.updateOne(
      {
        warehouse_id: demand.warehouse_id,
        sku_id: demand.sku_id,
        $expr: {
          $gte: [{ $subtract: ['$on_hand', '$reserved'] }, demand.qty],
        },
      },
      {
        $inc: { reserved: demand.qty },
        $set: { updated_at: now },
      },
    ).session(session || null);

    if (updateRes.matchedCount === 0) {
      // Find current balance to build conflict card
      const currentBal = await InventoryBalance.findOne({
        warehouse_id: demand.warehouse_id,
        sku_id: demand.sku_id,
      }).session(session || null);

      const free = currentBal ? Math.max(0, currentBal.on_hand - currentBal.reserved) : 0;

      // Find competing plans holding reservations for this SKU & warehouse
      const competingHolds = await StockReservation.find({
        warehouse_id: demand.warehouse_id,
        sku_id: demand.sku_id,
        status: 'HELD',
      }).session(session || null);

      const holdingPlanIds = Array.from(new Set(competingHolds.map((h) => h.plan_id.toString())));

      // Allocation Conflict Court (A4): Create exactly ONE case if competing plan exists
      if (holdingPlanIds.length > 0) {
        const otherPlanId = holdingPlanIds[0];
        const existingCase = await AllocationConflict.findOne({
          sku_id: demand.sku_id,
          warehouse_id: demand.warehouse_id,
          status: 'OPEN',
        }).session(session || null);

        if (!existingCase) {
          const [newCase] = await AllocationConflict.create(
            [
              {
                sku_id: demand.sku_id,
                warehouse_id: demand.warehouse_id,
                total_requested: demand.qty,
                available: free,
                status: 'OPEN',
                created_at: now,
              },
            ],
            { session },
          );

          // Insert allocation claims for both plans
          await AllocationClaim.create(
            [
              {
                conflict_id: newCase._id,
                plan_id: pId,
                order_id: actions[0]?.to_warehouse_id || demand.warehouse_id,
                requested_qty: demand.qty,
                granted_qty: 0,
                priority_score: 80,
                reason: `Proposed recovery plan ${pId} requires ${demand.qty} units`,
              },
              {
                conflict_id: newCase._id,
                plan_id: new mongoose.Types.ObjectId(otherPlanId),
                order_id: actions[0]?.to_warehouse_id || demand.warehouse_id,
                requested_qty: competingHolds.reduce((s, h) => s + h.quantity, 0),
                granted_qty: 0,
                priority_score: 75,
                reason: `Active held reservation for plan ${otherPlanId}`,
              },
            ],
            { session },
          );
        }
      }

      return {
        success: false,
        reservationIds: [],
        conflictReason: `Stock reservation conflict: Warehouse ${demand.warehouse_id} has insufficient free stock for SKU ${demand.sku_id}. Needed ${demand.qty}, available ${free}.`,
        conflictCard: {
          warehouse_id: demand.warehouse_id.toString(),
          sku_id: demand.sku_id.toString(),
          needed: demand.qty,
          free,
          holding_plans: holdingPlanIds,
        },
      };
    }

    // Reservation succeeded: record individual actions
    for (const actionId of demand.action_ids) {
      const act = actions.find((a) => a._id.toString() === actionId.toString());
      if (act) {
        const [resDoc] = await StockReservation.create(
          [
            {
              plan_id: pId,
              action_id: act._id,
              warehouse_id: demand.warehouse_id,
              sku_id: demand.sku_id,
              quantity: act.quantity,
              status: 'HELD',
              reserved_at: now,
              expires_at: expiresAt,
              released_at: null,
            },
          ],
          { session },
        );
        reservationIds.push(resDoc._id.toString());
      }
    }
  }

  return { success: true, reservationIds };
}

/**
 * Release all HELD reservations for a plan and restore reserved counts.
 */
export async function releaseStock(
  planId: mongoose.Types.ObjectId | string,
  session?: ClientSession,
): Promise<{ releasedCount: number }> {
  const pId = typeof planId === 'string' ? new mongoose.Types.ObjectId(planId) : planId;
  const reservations = await StockReservation.find({
    plan_id: pId,
    status: 'HELD',
  }).session(session || null);

  const now = await simClock.now();
  let count = 0;

  for (const res of reservations) {
    await InventoryBalance.updateOne(
      { warehouse_id: res.warehouse_id, sku_id: res.sku_id },
      {
        $inc: { reserved: -res.quantity },
        $set: { updated_at: now },
      },
    ).session(session || null);

    res.status = 'RELEASED';
    res.released_at = now;
    await res.save({ session });
    count++;
  }

  return { releasedCount: count };
}

/**
 * Convert HELD reservations to CONSUMED upon execution.
 */
export async function commitStock(
  planId: mongoose.Types.ObjectId | string,
  session?: ClientSession,
): Promise<void> {
  const pId = typeof planId === 'string' ? new mongoose.Types.ObjectId(planId) : planId;
  await StockReservation.updateMany(
    { plan_id: pId, status: 'HELD' },
    { $set: { status: 'CONSUMED' } },
  ).session(session || null);
}

/**
 * Reaper: sweep and release any expired HELD reservations.
 */
export async function reapExpiredReservations(): Promise<{ reapedCount: number }> {
  const now = await simClock.now();
  const expired = await StockReservation.find({
    status: 'HELD',
    expires_at: { $lte: now },
  });

  let count = 0;
  for (const res of expired) {
    await InventoryBalance.updateOne(
      { warehouse_id: res.warehouse_id, sku_id: res.sku_id },
      {
        $inc: { reserved: -res.quantity },
        $set: { updated_at: now },
      },
    );

    res.status = 'RELEASED';
    res.released_at = now;
    await res.save();
    count++;
  }

  return { reapedCount: count };
}
