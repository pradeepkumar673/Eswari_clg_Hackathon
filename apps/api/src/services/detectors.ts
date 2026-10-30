/**
 * apps/api/src/services/detectors.ts
 *
 * Late-Shipment Detector (B6) & Stock Alerts Engine (B7) (Step 10).
 * Idempotent alert generation with unique partial indexes.
 */

import mongoose from 'mongoose';
import { Shipment } from '../models/shipments.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { StockThreshold } from '../models/stock-thresholds.js';
import { Order } from '../models/orders.js';
import { OrderLine } from '../models/order-lines.js';
import { Alert } from '../models/alerts.js';
import { processShipmentImpact } from './impactEngine.js';
import { simClock } from './simClock.js';

export interface DetectorRunResult {
  lateShipmentAlerts: number;
  belowThresholdAlerts: number;
  projectedShortageAlerts: number;
  clearedAlerts: number;
}

/**
 * Runs both Late-Shipment and Stock detectors.
 */
export async function runDetectors(graceMinutes = 60): Promise<DetectorRunResult> {
  const now = await simClock.now();
  let lateCount = 0;
  let belowCount = 0;
  let projectedCount = 0;
  let clearedCount = 0;

  // -------------------------------------------------------------------------
  // 1. Late-Shipment Detector (B6)
  // -------------------------------------------------------------------------
  const shipments = await Shipment.find({
    status: { $in: ['IN_TRANSIT', 'DELIVERED'] },
  });

  for (const shp of shipments) {
    const effectiveEta = shp.resolved_eta || shp.current_eta;
    const graceMs = graceMinutes * 60 * 1000;
    const isLateEta = effectiveEta.getTime() > shp.promised_eta.getTime() + graceMs;
    const isPastArrivalWithoutDelivery =
      shp.status === 'IN_TRANSIT' && now.getTime() > shp.promised_eta.getTime() + graceMs;

    const isLate = isLateEta || isPastArrivalWithoutDelivery;
    const alertKey = `LATE_SHIPMENT:${shp.code}`;

    if (isLate) {
      const delayMinutes = Math.round(
        (Math.max(effectiveEta.getTime(), now.getTime()) - shp.promised_eta.getTime()) / 60000,
      );

      const existing = await Alert.findOne({ alert_key: alertKey, status: 'OPEN' });
      if (!existing) {
        await Alert.create({
          alert_key: alertKey,
          type: 'LATE_SHIPMENT',
          severity: 'RED',
          status: 'OPEN',
          title: `Shipment ${shp.code} Delayed`,
          body: `Shipment ${shp.code} delayed by ${delayMinutes} minutes beyond promised ETA.`,
          entity_type: 'Shipment',
          entity_id: shp._id.toString(),
          first_seen: now,
          last_seen: now,
          payload: { delay_minutes: delayMinutes, promised_eta: shp.promised_eta, effective_eta: effectiveEta },
          created_at: now,
        });
        lateCount++;

        // Trigger or refresh impact analysis disruption
        await processShipmentImpact(shp._id, 'detector-run');
      }
    } else {
      // If was late before but no longer, clear it
      const openAlert = await Alert.findOne({ alert_key: alertKey, status: 'OPEN' });
      if (openAlert) {
        openAlert.status = 'CLEARED';
        openAlert.cleared_at = now;
        await openAlert.save();
        clearedCount++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Stock Alerts Engine (B7)
  // -------------------------------------------------------------------------
  const thresholds = await StockThreshold.find({});

  for (const th of thresholds) {
    const bal = await InventoryBalance.findOne({
      warehouse_id: th.warehouse_id,
      sku_id: th.sku_id,
    });

    const freeStock = bal ? Math.max(0, bal.on_hand - bal.reserved) : 0;
    const belowKey = `BELOW_THRESHOLD:${th.warehouse_id}:${th.sku_id}`;

    // A. BELOW_THRESHOLD
    if (freeStock < th.min_quantity) {
      const existing = await Alert.findOne({ alert_key: belowKey, status: 'OPEN' });
      if (!existing) {
        await Alert.create({
          alert_key: belowKey,
          type: 'BELOW_THRESHOLD',
          severity: 'AMBER',
          status: 'OPEN',
          title: `Stock Below Minimum Level`,
          body: `Free stock (${freeStock}) is below minimum threshold (${th.min_quantity}) for SKU ${th.sku_id}.`,
          entity_type: 'InventoryBalance',
          entity_id: bal ? bal._id.toString() : `${th.warehouse_id}:${th.sku_id}`,
          first_seen: now,
          last_seen: now,
          payload: { free_stock: freeStock, min_quantity: th.min_quantity },
          created_at: now,
        });
        belowCount++;
      }
    } else {
      const openAlert = await Alert.findOne({ alert_key: belowKey, status: 'OPEN' });
      if (openAlert) {
        openAlert.status = 'CLEARED';
        openAlert.cleared_at = now;
        await openAlert.save();
        clearedCount++;
      }
    }

    // B. PROJECTED_SHORTAGE within horizon_hours
    const horizonMs = (th.horizon_hours || 72) * 3600 * 1000;
    const horizonEnd = new Date(now.getTime() + horizonMs);

    // Sum open orders due inside horizon
    const dueOrders = await Order.find({
      warehouse_id: th.warehouse_id,
      due_at: { $lte: horizonEnd },
      status: { $in: ['OPEN', 'RECOVERING'] },
    });

    let demandInsideHorizon = 0;
    for (const ord of dueOrders) {
      const line = await OrderLine.findOne({ order_id: ord._id, sku_id: th.sku_id });
      if (line) demandInsideHorizon += line.quantity;
    }

    // Reconciled usable inbound arriving inside horizon
    const inboundShipments = await Shipment.find({
      warehouse_id: th.warehouse_id,
      status: 'IN_TRANSIT',
    });

    let usableInbound = 0;
    for (const inb of inboundShipments) {
      const eta = inb.resolved_eta || inb.current_eta;
      if (eta.getTime() <= horizonEnd.getTime()) {
        usableInbound += inb.usable_quantity !== null && inb.usable_quantity !== undefined ? inb.usable_quantity : inb.total_units;
      }
    }

    const projectedShortage = (freeStock + usableInbound) - demandInsideHorizon;
    const shortageKey = `PROJECTED_SHORTAGE:${th.warehouse_id}:${th.sku_id}`;

    if (projectedShortage < 0) {
      const existing = await Alert.findOne({ alert_key: shortageKey, status: 'OPEN' });
      if (!existing) {
        await Alert.create({
          alert_key: shortageKey,
          type: 'PROJECTED_SHORTAGE',
          severity: 'RED',
          status: 'OPEN',
          title: `Projected Stock Shortage`,
          body: `Projected shortage of ${Math.abs(projectedShortage)} units within ${th.horizon_hours}h horizon (Demand: ${demandInsideHorizon}, Available: ${freeStock + usableInbound}).`,
          entity_type: 'InventoryBalance',
          entity_id: bal ? bal._id.toString() : `${th.warehouse_id}:${th.sku_id}`,
          first_seen: now,
          last_seen: now,
          payload: {
            projected_shortage: projectedShortage,
            free_stock: freeStock,
            usable_inbound: usableInbound,
            demand: demandInsideHorizon,
            horizon_hours: th.horizon_hours,
          },
          created_at: now,
        });
        projectedCount++;
      }
    } else {
      const openAlert = await Alert.findOne({ alert_key: shortageKey, status: 'OPEN' });
      if (openAlert) {
        openAlert.status = 'CLEARED';
        openAlert.cleared_at = now;
        await openAlert.save();
        clearedCount++;
      }
    }
  }

  return {
    lateShipmentAlerts: lateCount,
    belowThresholdAlerts: belowCount,
    projectedShortageAlerts: projectedCount,
    clearedAlerts: clearedCount,
  };
}
