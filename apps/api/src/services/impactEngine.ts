/**
 * apps/api/src/services/impactEngine.ts
 *
 * Impact Engine and Deterministic Risk Waterfall (M3, B5).
 * Subscribes to EVENT_APPLIED and ETA_CHANGED on the domain bus.
 *
 * Walks shipment -> destination warehouse -> inventory -> dependent open orders.
 * Computes exact risk score:
 *   Risk = 100 * (0.35 * U + 0.30 * S + 0.20 * D + 0.15 * P)
 * Opens or refreshes ONE disruption per shipment.
 */

import mongoose from 'mongoose';
import { domainBus } from './bus.js';
import { Shipment, IShipment } from '../models/shipments.js';
import { ShipmentLine } from '../models/shipment-lines.js';
import { Warehouse } from '../models/warehouses.js';
import { Order, IOrder } from '../models/orders.js';
import { OrderLine } from '../models/order-lines.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { Disruption, IDisruption } from '../models/disruptions.js';
import { OrderRiskSnapshot, IOrderRiskSnapshot } from '../models/order-risk-snapshots.js';
import { RiskPolicy } from '../models/risk-policies.js';
import { simClock } from './simClock.js';

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function priorityToNumber(priority: string): number {
  switch (priority.toUpperCase()) {
    case 'CRITICAL':
      return 5;
    case 'HIGH':
      return 4;
    case 'MEDIUM':
      return 3;
    case 'LOW':
    default:
      return 2;
  }
}

export function computePriorityFactor(priority: string): number {
  const p = priorityToNumber(priority);
  return (p - 1) / 4;
}

export function computeUrgency(slackHours: number): number {
  if (slackHours <= 0) return 1;
  return clamp(1 - slackHours / 72, 0, 1);
}

export function computeDelayFactor(delayHours: number, slackHours: number): number {
  const denom = slackHours + 24;
  if (denom <= 0) return 1;
  return clamp(delayHours / denom, 0, 1);
}

export function computeRiskScore(u: number, s: number, d: number, p: number): number {
  const raw = 100 * (0.35 * u + 0.30 * s + 0.20 * d + 0.15 * p);
  return Math.round(raw * 100) / 100;
}

export async function getBandForScore(score: number): Promise<'RED' | 'AMBER' | 'GREEN'> {
  const policies = await RiskPolicy.find({}).lean();
  for (const pol of policies) {
    if (score >= pol.min_score && score <= pol.max_score) {
      return pol.band as 'RED' | 'AMBER' | 'GREEN';
    }
  }
  if (score >= 70) return 'RED';
  if (score >= 40) return 'AMBER';
  return 'GREEN';
}

export interface ImpactRunResult {
  disruption: IDisruption;
  affected_orders: Array<{
    order_code: string;
    risk_score: number;
    best_case_score: number;
    worst_case_score: number;
    band: string;
    factors: {
      U: number;
      S: number;
      D: number;
      P: number;
    };
    evidence_ids: Record<string, string>;
  }>;
}

export async function processShipmentImpact(
  shipmentIdOrCode: string | mongoose.Types.ObjectId,
  correlationId = 'impact-run',
  eventId?: string,
): Promise<ImpactRunResult | null> {
  const query = mongoose.Types.ObjectId.isValid(String(shipmentIdOrCode))
    ? { _id: shipmentIdOrCode }
    : { code: shipmentIdOrCode };

  const shipment = await Shipment.findOne(query);
  if (!shipment) return null;

  const now = await simClock.now();
  const warehouse = await Warehouse.findById(shipment.warehouse_id).lean();
  if (!warehouse) return null;

  const shipmentLines = await ShipmentLine.find({ shipment_id: shipment._id }).lean();
  const affectedSkuIds = shipmentLines.map((l) => l.sku_id);

  // Ready time at warehouse = ETA + warehouse processing hours
  const resolvedEta = shipment.resolved_eta || shipment.current_eta;
  const processingHours = warehouse.processing_hours || 2;
  const projectedArrival = new Date(resolvedEta.getTime() + processingHours * 3600000);

  // Calculate delay relative to promised ETA
  const delayMs = Math.max(0, resolvedEta.getTime() - shipment.promised_eta.getTime());
  const delayHours = Math.round(delayMs / 3600000);

  // Usable units (damaged units reduce usable quantity)
  const usableQuantity =
    shipment.usable_quantity !== null && shipment.usable_quantity !== undefined
      ? shipment.usable_quantity
      : shipment.total_units;

  // Calendar tag (festival peak check)
  const isFestivalPeak = now.getUTCMonth() === 10; // November peak window
  const calendarTag = isFestivalPeak ? 'FESTIVAL_PEAK' : null;

  // Determine disruption type
  let disruptionType: string = 'LATE_SHIPMENT';
  if (usableQuantity < shipment.total_units) {
    disruptionType = 'DAMAGE';
  } else if (delayHours > 0) {
    disruptionType = 'LATE_SHIPMENT';
  }

  // Find or create ONE disruption for this shipment
  let disruption = await Disruption.findOne({ shipment_id: shipment._id });
  const eventObjId = eventId && mongoose.Types.ObjectId.isValid(eventId)
    ? new mongoose.Types.ObjectId(eventId)
    : shipment.eta_basis_event_id || new mongoose.Types.ObjectId();

  if (!disruption) {
    disruption = await Disruption.create({
      shipment_id: shipment._id,
      disruption_type: disruptionType,
      severity: 'AMBER',
      usable_quantity: usableQuantity,
      original_quantity: shipment.total_units,
      delay_hours: delayHours,
      detected_at: now,
      resolved_at: null,
      created_by_event_id: eventObjId,
      calendar_tag: calendarTag,
      correlation_id: correlationId,
      status: 'OPEN',
    });
  } else {
    disruption.disruption_type = disruptionType;
    disruption.usable_quantity = usableQuantity;
    disruption.delay_hours = delayHours;
    disruption.calendar_tag = calendarTag;
    disruption.correlation_id = correlationId;
    if (eventId && mongoose.Types.ObjectId.isValid(eventId)) {
      disruption.created_by_event_id = new mongoose.Types.ObjectId(eventId);
    }
    await disruption.save();
  }

  // Find dependent open orders at this warehouse that demand the shipment's SKUs
  const openOrders = await Order.find({
    warehouse_id: warehouse._id,
    status: 'OPEN',
  }).lean();

  const affectedOrdersSummary: ImpactRunResult['affected_orders'] = [];
  let maxScore = 0;

  // Iterate over each SKU
  for (const skuId of affectedSkuIds) {
    const invBalance = await InventoryBalance.findOne({
      warehouse_id: warehouse._id,
      sku_id: skuId,
    }).lean();

    const onHand = invBalance?.on_hand || 0;
    const reserved = invBalance?.reserved || 0;
    const freeStock = Math.max(0, onHand - reserved);

    // Total available supply for this SKU
    const totalAvailable = freeStock + usableQuantity;

    // Find order lines demanding this SKU
    const orderLines = await OrderLine.find({
      order_id: { $in: openOrders.map((o) => o._id) },
      sku_id: skuId,
    }).lean();

    // Map order lines back to orders
    const relevantOrders: Array<{ order: any; line: any }> = [];
    for (const ord of openOrders) {
      const line = orderLines.find((l) => String(l.order_id) === String(ord._id));
      if (line) {
        relevantOrders.push({ order: ord, line });
      }
    }

    // Sort relevant orders by due_at ascending, then priority descending
    relevantOrders.sort((a, b) => {
      const timeDiff = new Date(a.order.due_at).getTime() - new Date(b.order.due_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return priorityToNumber(b.order.priority) - priorityToNumber(a.order.priority);
    });

    // Allocate available stock sequentially to compute shortage factor S
    let remainingSupply = totalAvailable;

    for (const { order, line } of relevantOrders) {
      const required = line.quantity;
      const allocated = Math.min(remainingSupply, required);
      const shortage = Math.max(0, required - allocated);
      remainingSupply = Math.max(0, remainingSupply - allocated);

      // Compute Slack = due_time - projected_arrival
      const dueMs = new Date(order.due_at).getTime();
      const slackMs = dueMs - projectedArrival.getTime();
      const slackHours = slackMs / 3600000;

      // Only affect orders that are either genuinely short or whose due date is impacted
      // For Scenario A: slack <= 0 OR shortage > 0
      const isAffected = slackHours <= 12 || shortage > 0 || delayHours > 0;
      if (!isAffected) continue;

      const U = computeUrgency(slackHours);
      const S = shortage / required;
      const D = computeDelayFactor(delayHours, slackHours);
      const P = computePriorityFactor(order.priority);

      const riskScore = computeRiskScore(U, S, D, P);
      maxScore = Math.max(maxScore, riskScore);

      // Best-case ETA: promised ETA (delay_hours = 0, arrival 2h after promised ETA)
      const bestArrival = new Date(shipment.promised_eta.getTime() + processingHours * 3600000);
      const bestSlack = (dueMs - bestArrival.getTime()) / 3600000;
      const bestU = computeUrgency(bestSlack);
      const bestD = computeDelayFactor(0, bestSlack);
      const bestScore = computeRiskScore(bestU, S, bestD, P);

      // Worst-case ETA: resolved ETA + 4h buffer
      const worstArrival = new Date(projectedArrival.getTime() + 4 * 3600000);
      const worstSlack = (dueMs - worstArrival.getTime()) / 3600000;
      const worstU = computeUrgency(worstSlack);
      const worstD = computeDelayFactor(delayHours + 4, worstSlack);
      const worstScore = computeRiskScore(worstU, S, worstD, P);

      const band = await getBandForScore(riskScore);

      const evidenceIds: Record<string, string> = {
        order_id: order._id.toString(),
        order_line_id: line._id.toString(),
        inventory_id: invBalance?._id ? invBalance._id.toString() : '',
        shipment_id: shipment._id.toString(),
      };
      if (eventId) {
        evidenceIds.event_id = eventId;
      }

      // Upsert order_risk_snapshots
      await OrderRiskSnapshot.findOneAndUpdate(
        { order_id: order._id },
        {
          $set: {
            disruption_id: disruption._id,
            risk_score: riskScore,
            best_case_score: bestScore,
            worst_case_score: worstScore,
            urgency: Math.round(U * 1000) / 1000,
            supply_gap: Math.round(S * 1000) / 1000,
            delay_factor: Math.round(D * 1000) / 1000,
            penalty_factor: Math.round(P * 1000) / 1000,
            band,
            evidence_ids: evidenceIds,
            snapshot_at: now,
          },
        },
        { upsert: true, new: true },
      );

      affectedOrdersSummary.push({
        order_code: order.code,
        risk_score: riskScore,
        best_case_score: bestScore,
        worst_case_score: worstScore,
        band,
        factors: {
          U: Math.round(U * 1000) / 1000,
          S: Math.round(S * 1000) / 1000,
          D: Math.round(D * 1000) / 1000,
          P: Math.round(P * 1000) / 1000,
        },
        evidence_ids: evidenceIds,
      });
    }
  }

  // Update disruption severity based on max risk score
  const severity = await getBandForScore(maxScore);
  disruption.severity = severity;
  await disruption.save();

  await domainBus.publish('DISRUPTION_OPENED', {
    disruptionId: disruption._id.toString(),
    shipmentId: shipment._id.toString(),
    type: disruption.disruption_type,
    correlationId,
  });

  return {
    disruption,
    affected_orders: affectedOrdersSummary,
  };
}

// Auto-wire to domain bus on module load
domainBus.subscribe('EVENT_APPLIED', async (payload: any) => {
  try {
    await processShipmentImpact(payload.shipmentId, payload.correlationId, payload.eventId);
  } catch (err) {
    // Log but don't crash
  }
});

domainBus.subscribe('ETA_CHANGED', async (payload: any) => {
  try {
    await processShipmentImpact(payload.shipmentId, payload.correlationId);
  } catch (err) {
    // Log but don't crash
  }
});

