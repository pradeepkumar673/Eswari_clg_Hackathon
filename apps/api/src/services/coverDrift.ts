/**
 * apps/api/src/services/coverDrift.ts
 *
 * Step 11 Part A – Cover and Drift (B13).
 *
 * GET /projections/cover
 *   days_of_cover = free_stock / (units_due_next_7d / 7)
 *   free_stock = on_hand - reserved
 *   units_due_next_7d = SUM(order_lines.qty) for orders due within 7 calendar days
 *   cover = 0 is critical
 *
 * GET /shipments/:id/eta-drift
 *   Shows hint only after 3+ APPLIED revisions that all moved later;
 *   avg shift per revision, labelled "projection"
 */

import mongoose from 'mongoose';
import { InventoryBalance } from '../models/inventory-balances.js';
import { OrderLine } from '../models/order-lines.js';
import { Order } from '../models/orders.js';
import { Sku } from '../models/skus.js';
import { Warehouse } from '../models/warehouses.js';
import { ShipmentEvent } from '../models/shipment-events.js';
import { simClock } from './simClock.js';

// ---------------------------------------------------------------------------
// Cover: days of stock coverage per SKU/warehouse
// ---------------------------------------------------------------------------

export async function computeCover(): Promise<{ cover: any[]; method: 'rule-based' }> {
  const now = await simClock.now();
  const sevenDays = new Date(now.getTime() + 7 * 86_400_000);

  const balances = await InventoryBalance.find({}).lean();

  const results = await Promise.all(
    balances.map(async (bal) => {
      const freeStock = bal.on_hand - bal.reserved;

      // Orders due in next 7 days for this sku/warehouse
      const dueOrders = await Order.find({
        warehouse_id: bal.warehouse_id,
        due_at: { $gte: now, $lte: sevenDays },
      })
        .select('_id')
        .lean();

      const orderIds = dueOrders.map((o) => o._id);

      let unitsDue = 0;
      if (orderIds.length > 0) {
        const lines = await OrderLine.find({
          order_id: { $in: orderIds },
          sku_id: bal.sku_id,
        }).lean();
        unitsDue = lines.reduce((sum, l) => sum + (l.quantity || 0), 0);
      }

      const dailyDemand = unitsDue / 7;
      let daysOfCover: number | null;
      let formula: string;

      if (dailyDemand <= 0) {
        daysOfCover = null;
        formula = `free_stock(${freeStock}) / (units_due_7d(${unitsDue}) / 7) = N/A (no demand)`;
      } else {
        daysOfCover = Math.round((freeStock / dailyDemand) * 10) / 10;
        formula = `free_stock(${freeStock}) / (units_due_7d(${unitsDue}) / 7) = ${daysOfCover}d`;
      }

      const sku = await Sku.findById(bal.sku_id).select('code name').lean();
      const wh = await Warehouse.findById(bal.warehouse_id).select('code name').lean();

      return {
        warehouse_id: bal.warehouse_id,
        warehouse_code: (wh as any)?.code,
        sku_id: bal.sku_id,
        sku_code: (sku as any)?.code,
        on_hand: bal.on_hand,
        reserved: bal.reserved,
        free_stock: freeStock,
        units_due_7d: unitsDue,
        days_of_cover: daysOfCover,
        formula,
        critical: daysOfCover !== null && daysOfCover <= 0,
        label: 'projection',
      };
    }),
  );

  return { cover: results, method: 'rule-based' };
}

// ---------------------------------------------------------------------------
// ETA Drift for a shipment
// ---------------------------------------------------------------------------

export async function computeEtaDrift(
  shipmentId: string,
): Promise<{ drift: any | null; method: 'rule-based' }> {
  const APPLIED_TYPES = ['ETA_UPDATE', 'DELAY_REPORTED'];
  const MIN_REVISIONS = 3;

  // Get APPLIED events for this shipment, sorted chronologically
  const events = await ShipmentEvent.find({
    shipment_id: new mongoose.Types.ObjectId(shipmentId),
    status: 'APPLIED',
    event_type: { $in: APPLIED_TYPES },
    new_eta: { $ne: null },
  })
    .sort({ occurred_at: 1 })
    .lean();

  if (events.length < MIN_REVISIONS) {
    return {
      drift: {
        hint: null,
        revision_count: events.length,
        min_revisions_required: MIN_REVISIONS,
        label: 'projection',
      },
      method: 'rule-based',
    };
  }

  // Check if all revisions moved later
  let allMovedLater = true;
  let totalShiftHours = 0;
  const shifts: number[] = [];

  for (let i = 1; i < events.length; i++) {
    const prev = (events[i - 1] as any).new_eta;
    const curr = (events[i] as any).new_eta;
    if (!prev || !curr) { allMovedLater = false; break; }
    const shiftHours = (new Date(curr).getTime() - new Date(prev).getTime()) / 3_600_000;
    if (shiftHours <= 0) { allMovedLater = false; break; }
    shifts.push(shiftHours);
    totalShiftHours += shiftHours;
  }

  if (!allMovedLater || shifts.length === 0) {
    return {
      drift: {
        hint: null,
        revision_count: events.length,
        all_moved_later: false,
        label: 'projection',
      },
      method: 'rule-based',
    };
  }

  const avgShiftHours = Math.round((totalShiftHours / shifts.length) * 10) / 10;

  return {
    drift: {
      hint: `ETA has moved later in all ${events.length} revisions. Average shift: +${avgShiftHours}h per revision. Expect further delays.`,
      revision_count: events.length,
      avg_shift_hours: avgShiftHours,
      all_moved_later: true,
      label: 'projection',
    },
    method: 'rule-based',
  };
}

