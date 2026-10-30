/**
 * apps/api/src/services/capacityService.ts
 *
 * Deterministic warehouse zone occupancy, colour classification,
 * polygon validation (0-1000 space, non-self-intersecting), and alert synchronization.
 */

import { Zone } from '../models/zones.js';
import { ZoneStockAssignment } from '../models/zone-stock-assignments.js';
import { InboundSlotPlan } from '../models/inbound-slot-plans.js';
import { Sku } from '../models/skus.js';
import { Alert } from '../models/alerts.js';
import { broadcastToTopic } from './websocket.js';

export type ZoneColour = 'GREEN' | 'AMBER' | 'RED';

export interface ZoneColourResult {
  colour: ZoneColour;
  capacity_slots: number;
  occupied_slots: number;
  reserved_inbound_slots: number;
  projected_slots: number;
  utilization_pct: number;
  explanation: string;
}

export interface ZoneOccupancy {
  zone_id: string;
  name: string;
  warehouse_id: string;
  zone_type: string;
  capacity_slots: number;
  occupied_slots: number;
  reserved_inbound_slots: number;
  projected_slots: number;
  utilization_pct: number;
  colour: ZoneColour;
  explanation: string;
  assignments: Array<{ sku_id: string; units: number; slots: number }>;
  inbound_plans: Array<{ plan_id: string; shipment_id: string; slots: number; status: string }>;
}

/**
 * Determines color and generates explanation sentence based on capacity and slots.
 */
export function getZoneColour(
  capacitySlots: number,
  occupiedSlots: number,
  reservedInboundSlots: number,
): ZoneColourResult {
  const projectedSlots = occupiedSlots + reservedInboundSlots;
  const ratio = capacitySlots > 0 ? projectedSlots / capacitySlots : 0;
  const utilizationPct = Math.round(ratio * 100);

  let colour: ZoneColour = 'GREEN';
  let explanation = '';

  if (ratio > 1.0) {
    colour = 'RED';
    const overage = projectedSlots - capacitySlots;
    explanation = `Projected ${projectedSlots} of ${capacitySlots} slots, over capacity by ${overage}.`;
  } else if (ratio >= 0.8) {
    colour = 'AMBER';
    explanation = `Projected ${projectedSlots} of ${capacitySlots} slots (${utilizationPct}%), within capacity.`;
  } else {
    colour = 'GREEN';
    explanation = `Projected ${projectedSlots} of ${capacitySlots} slots (${utilizationPct}%), within capacity.`;
  }

  return {
    colour,
    capacity_slots: capacitySlots,
    occupied_slots: occupiedSlots,
    reserved_inbound_slots: reservedInboundSlots,
    projected_slots: projectedSlots,
    utilization_pct: utilizationPct,
    explanation,
  };
}

/**
 * Computes deterministic occupancy for a specific zone.
 * occupied_slots = sum over SKUs of ceil(units / units_per_slot).
 */
export async function computeZoneOccupancy(zoneId: string): Promise<ZoneOccupancy> {
  const zone = await Zone.findOne({ zone_id: zoneId }).lean();
  if (!zone) {
    throw new Error(`Zone ${zoneId} not found`);
  }

  // 1. Fetch assignments
  const assignments = await ZoneStockAssignment.find({ zone_id: zoneId }).lean();
  const allSkus = await Sku.find({}).lean();
  const skuMap = new Map<string, any>();
  for (const s of allSkus) {
    skuMap.set(s.code, s);
    skuMap.set(s._id.toString(), s);
  }

  let occupiedSlots = 0;
  const processedAssignments = assignments.map((a) => {
    const sku = skuMap.get(a.sku_id);
    const unitsPerSlot = sku?.units_per_slot || 10;
    const slots = Math.ceil(a.units / unitsPerSlot);
    occupiedSlots += slots;
    return {
      sku_id: a.sku_id,
      units: a.units,
      slots,
    };
  });

  // 2. Fetch active PLANNED inbound plans
  const inboundPlans = await InboundSlotPlan.find({
    zone_id: zoneId,
    status: 'PLANNED',
  }).lean();

  const reservedInboundSlots = inboundPlans.reduce((sum, p) => sum + p.slots, 0);

  // 3. Compute colour and explanation
  const metrics = getZoneColour(zone.capacity_slots, occupiedSlots, reservedInboundSlots);

  // 4. Synchronize ZONE_OVER_CAPACITY alert
  await syncZoneOverCapacityAlert(zoneId, zone.warehouse_id, metrics.colour, metrics.explanation);

  return {
    zone_id: zone.zone_id,
    name: zone.name,
    warehouse_id: zone.warehouse_id,
    zone_type: zone.zone_type,
    capacity_slots: zone.capacity_slots,
    occupied_slots: occupiedSlots,
    reserved_inbound_slots: reservedInboundSlots,
    projected_slots: metrics.projected_slots,
    utilization_pct: metrics.utilization_pct,
    colour: metrics.colour,
    explanation: metrics.explanation,
    assignments: processedAssignments,
    inbound_plans: inboundPlans.map((p) => ({
      plan_id: p._id.toString(),
      shipment_id: p.shipment_id,
      slots: p.slots,
      status: p.status,
    })),
  };
}

/**
 * Ensures exactly one active ZONE_OVER_CAPACITY alert while RED, and resolves it when not RED.
 */
export async function syncZoneOverCapacityAlert(
  zoneId: string,
  warehouseId: string,
  colour: ZoneColour,
  explanation: string,
): Promise<void> {
  const alertKey = `ZONE_OVER_CAPACITY:${zoneId}`;
  const existingAlert = await Alert.findOne({
    alert_key: alertKey,
    status: 'OPEN',
  });

  if (colour === 'RED') {
    if (!existingAlert) {
      const now = new Date();
      await Alert.create({
        alert_key: alertKey,
        type: 'ZONE_OVER_CAPACITY',
        severity: 'RED',
        status: 'OPEN',
        title: `Zone ${zoneId} Over Capacity`,
        body: explanation,
        entity_type: 'Zone',
        entity_id: zoneId,
        first_seen: now,
        last_seen: now,
        created_at: now,
        payload: {
          zone_id: zoneId,
          warehouse_id: warehouseId,
        },
      });

      await broadcastToTopic('alerts', {
        type: 'ZONE_OVER_CAPACITY',
        zone_id: zoneId,
        warehouse_id: warehouseId,
        message: explanation,
      });
    }
  } else {
    // If not RED and alert exists, resolve / clear it
    if (existingAlert) {
      existingAlert.status = 'CLEARED';
      existingAlert.cleared_at = new Date();
      await existingAlert.save();

      await broadcastToTopic('alerts', {
        type: 'ZONE_CAPACITY_NORMALIZED',
        zone_id: zoneId,
        warehouse_id: warehouseId,
        message: `Zone ${zoneId} capacity normalized (${colour})`,
      });
    }
  }
}

/**
 * Validates a polygon:
 * - Coordinates within 0 to 1000
 * - Minimum 3 vertices
 * - Rejects self-intersecting polygons
 */
export function validateZonePolygon(points: Array<[number, number]>): { valid: boolean; error?: string } {
  if (!Array.isArray(points) || points.length < 3) {
    return { valid: false, error: 'Polygon must contain at least 3 points' };
  }

  // Check bounds [0, 1000]
  for (const pt of points) {
    if (!Array.isArray(pt) || pt.length !== 2) {
      return { valid: false, error: 'Points must be [x, y] tuples' };
    }
    const [x, y] = pt;
    if (x < 0 || x > 1000 || y < 0 || y > 1000) {
      return { valid: false, error: `Point [${x}, ${y}] outside 0-1000 coordinate space` };
    }
  }

  // Segment intersection check
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];

    for (let j = i + 1; j < n; j++) {
      // Adjacent segments naturally share a vertex; skip
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) {
        continue;
      }

      const b1 = points[j];
      const b2 = points[(j + 1) % n];

      if (segmentsIntersect(a1, a2, b1, b2)) {
        return { valid: false, error: 'Polygon edges cannot self-intersect' };
      }
    }
  }

  return { valid: true };
}

function ccw(p1: [number, number], p2: [number, number], p3: [number, number]): number {
  return (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
}

function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): boolean {
  const ccw1 = ccw(p1, p2, p3);
  const ccw2 = ccw(p1, p2, p4);
  const ccw3 = ccw(p3, p4, p1);
  const ccw4 = ccw(p3, p4, p2);

  return (
    ((ccw1 > 0 && ccw2 < 0) || (ccw1 < 0 && ccw2 > 0)) &&
    ((ccw3 > 0 && ccw4 < 0) || (ccw3 < 0 && ccw4 > 0))
  );
}
