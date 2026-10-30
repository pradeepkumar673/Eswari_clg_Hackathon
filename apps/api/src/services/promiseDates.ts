/**
 * apps/api/src/services/promiseDates.ts
 *
 * Promise-Date Repair Engine (Step 9, A7).
 * For each affected order:
 *   - original = order.due_at
 *   - best recoverable = earliest time FULL quantity can be on hand
 *     (latest of sources needed: free stock now, transfer arrival, supplier lead time)
 *     + fulfilment warehouse processing hours (2 hours)
 *   - committed = proposed in plan (defaults to best recoverable)
 */

import mongoose from 'mongoose';
import { Order } from '../models/orders.js';
import { OrderPromiseDate, IOrderPromiseDate } from '../models/order-promise-dates.js';
import { PlanAction } from '../models/plan-actions.js';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { simClock } from './simClock.js';

export interface PromiseDateInfo {
  order_id: string;
  order_code: string;
  original_promise: string;
  best_recoverable: string;
  current_promise: string;
  delay_hours: number;
  basis: string;
  evidence_ids: string[];
}

export async function computePromiseDatesForPlan(
  planId: mongoose.Types.ObjectId | string,
): Promise<PromiseDateInfo[]> {
  const pId = typeof planId === 'string' ? new mongoose.Types.ObjectId(planId) : planId;
  const plan = await RecoveryPlan.findById(pId);
  if (!plan) throw new Error('Recovery plan not found');

  const actions = await PlanAction.find({ plan_id: pId });
  const now = await simClock.now();

  // Find all affected open orders for this plan
  const destWarehouseIds = Array.from(new Set(actions.map((a) => a.to_warehouse_id)));
  const orders = await Order.find({
    warehouse_id: { $in: destWarehouseIds },
    status: { $in: ['OPEN', 'RECOVERING'] },
  });

  const maxActionDuration = actions.reduce((max, a) => Math.max(max, a.duration_hours || 0), 0);
  const processingHours = 2; // warehouse processing time

  const results: PromiseDateInfo[] = [];

  for (const ord of orders) {
    const originalPromise = ord.due_at;

    // Earliest time full quantity is available = now + max duration needed + 2h processing
    const bestRecoverableMs = now.getTime() + (maxActionDuration + processingHours) * 3600 * 1000;
    const bestRecoverable = new Date(Math.max(originalPromise.getTime(), bestRecoverableMs));

    const delayHours = Math.max(0, Math.round((bestRecoverable.getTime() - originalPromise.getTime()) / 3600000));

    // Upsert or retrieve existing OrderPromiseDate
    const opd = await OrderPromiseDate.findOneAndUpdate(
      { order_id: ord._id },
      {
        $set: {
          original_promise: originalPromise,
          current_promise: bestRecoverable,
          delay_hours: delayHours,
          reason: `Recovery plan ${pId} (v${plan.version}): max action transit ${maxActionDuration}h + ${processingHours}h processing`,
          updated_at: now,
        },
      },
      { upsert: true, new: true },
    );

    results.push({
      order_id: ord._id.toString(),
      order_code: ord.code,
      original_promise: originalPromise.toISOString(),
      best_recoverable: bestRecoverable.toISOString(),
      current_promise: opd.current_promise.toISOString(),
      delay_hours: delayHours,
      basis: `Action transit: ${maxActionDuration}h, Processing: ${processingHours}h`,
      evidence_ids: [ord._id.toString(), ...(actions.map((a) => a._id.toString()))],
    });
  }

  // Save committed promise dates into plan's decision contract
  if (plan.decision_contract) {
    plan.decision_contract.committed_promise_dates = results.map((r) => ({
      order_code: r.order_code,
      promised_at: r.current_promise,
    }));
    await plan.save();
  }

  return results;
}
