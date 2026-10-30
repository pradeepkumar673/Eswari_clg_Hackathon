/**
 * apps/api/src/services/reservations.ts
 *
 * Clean interface for stock reservations (Step 8 Part B #2 & Step 9 plug-in).
 * Database-backed signature using StockReservation and InventoryBalance.
 */

import mongoose, { ClientSession } from 'mongoose';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { PlanAction } from '../models/plan-actions.js';
import { StockReservation } from '../models/stock-reservations.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { simClock } from './simClock.js';

export interface ReserveStockResult {
  success: boolean;
  reservationIds: string[];
  conflictReason?: string;
}

/**
 * Reserve stock for all actions in a recovery plan.
 * Verifies that free stock (on_hand - reserved) is sufficient.
 */
export async function reserveStock(
  planId: mongoose.Types.ObjectId | string,
  session?: ClientSession,
): Promise<ReserveStockResult> {
  const pId = typeof planId === 'string' ? new mongoose.Types.ObjectId(planId) : planId;
  const actions = await PlanAction.find({ plan_id: pId }).session(session || null);
  const now = await simClock.now();
  const reservationIds: string[] = [];

  for (const act of actions) {
    if (act.action_type === 'TRANSFER' && act.from_warehouse_id) {
      const bal = await InventoryBalance.findOne({
        warehouse_id: act.from_warehouse_id,
        sku_id: act.sku_id,
      }).session(session || null);

      if (!bal || (bal.on_hand - bal.reserved) < act.quantity) {
        return {
          success: false,
          reservationIds: [],
          conflictReason: `Insufficient stock at donor warehouse for SKU ${act.sku_id}. Needed ${act.quantity}, available ${bal ? bal.on_hand - bal.reserved : 0}`,
        };
      }

      // Increment reserved count on inventory balance
      bal.reserved += act.quantity;
      bal.updated_at = now;
      await bal.save({ session });

      const [resDoc] = await StockReservation.create(
        [
          {
            plan_id: pId,
            action_id: act._id,
            warehouse_id: act.from_warehouse_id,
            sku_id: act.sku_id,
            quantity: act.quantity,
            status: 'HELD',
            reserved_at: now,
            released_at: null,
          },
        ],
        { session },
      );
      reservationIds.push(resDoc._id.toString());
    }
  }

  return { success: true, reservationIds };
}

/**
 * Release any HELD reservations for a recovery plan.
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
    const bal = await InventoryBalance.findOne({
      warehouse_id: res.warehouse_id,
      sku_id: res.sku_id,
    }).session(session || null);

    if (bal) {
      bal.reserved = Math.max(0, bal.reserved - res.quantity);
      bal.updated_at = now;
      await bal.save({ session });
    }

    res.status = 'RELEASED';
    res.released_at = now;
    await res.save({ session });
    count++;
  }

  return { releasedCount: count };
}
