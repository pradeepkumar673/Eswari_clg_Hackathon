/**
 * apps/api/src/services/driverSimulator.ts
 *
 * Driver ping intake, lane-snapping (within 300m), geofence arrival detection,
 * rate limiting (60 pings/min/driver), and simulation clock tick advancing.
 */

import mongoose from 'mongoose';
import { DriverPing, IDriverPing } from '../models/driver-pings.js';
import { TransferLane } from '../models/transfer-lanes.js';
import { Warehouse } from '../models/warehouses.js';
import { Supplier } from '../models/suppliers.js';
import { Shipment } from '../models/shipments.js';
import { ShipmentEvent } from '../models/shipment-events.js';
import { User } from '../models/users.js';
import { simClock } from './simClock.js';
import { broadcastToTopic } from './websocket.js';
import { haversineDistanceKm } from './nearestWarehouse.js';
import { validateFix } from './gpsFix.js';

export const GEOFENCE_RADIUS_M = 1000; // 1 km geofence around warehouse
const MAX_SNAP_METERS = 300; // 300 meters maximum road snapping

// In-memory sliding window rate limiter: driver_id -> array of timestamps
const rateLimitMap = new Map<string, number[]>();

export interface InputPing {
  seq: number;
  ts: string | Date;
  lat: number;
  lng: number;
  speed_kmh: number;
  accuracy_m?: number | null;
  heading?: number | null;
  source?: 'SIM' | 'DRIVER_DEVICE';
}

export interface IntakeResult {
  accepted: number;
  duplicates: number;
  pings: Array<Record<string, any>>;
}

/**
 * Projects a point (lat, lng) onto segment (lat1, lng1)-(lat2, lng2).
 * Returns { distMeters, t (0..1) }.
 */
function projectPointToSegmentMeters(
  lat: number,
  lng: number,
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): { distMeters: number; t: number } {
  const midLat = (lat1 + lat2) / 2;
  const rad = (midLat * Math.PI) / 180;
  const mPerDegLat = 110540;
  const mPerDegLng = 111320 * Math.cos(rad);

  const x1 = 0;
  const y1 = 0;
  const x2 = (lng2 - lng1) * mPerDegLng;
  const y2 = (lat2 - lat1) * mPerDegLat;

  const xp = (lng - lng1) * mPerDegLng;
  const yp = (lat - lat1) * mPerDegLat;

  const lenSq = x2 * x2 + y2 * y2;
  if (lenSq === 0) {
    const dist = Math.sqrt(xp * xp + yp * yp);
    return { distMeters: dist, t: 0 };
  }

  const dot = xp * x2 + yp * y2;
  const t = Math.max(0, Math.min(1, dot / lenSq));

  const projX = t * x2;
  const projY = t * y2;

  const dx = xp - projX;
  const dy = yp - projY;
  const distMeters = Math.sqrt(dx * dx + dy * dy);

  return { distMeters, t };
}

/**
 * Snaps (lat, lng) to the closest TransferLane within 300m.
 */
export async function snapPingToLane(
  lat: number,
  lng: number,
): Promise<{ lane_id: string | null; km_on_lane: number | null }> {
  const lanes = await TransferLane.find({}).lean();
  const warehouses = await Warehouse.find({}).lean();
  const suppliers = await Supplier.find({}).lean();

  const nodeMap = new Map<string, { lat: number; lng: number }>();
  for (const w of warehouses) {
    if (w.lat !== undefined && w.lng !== undefined) {
      nodeMap.set(w._id.toString(), { lat: w.lat, lng: w.lng });
    }
  }
  for (const s of suppliers) {
    if (s.lat !== undefined && s.lng !== undefined) {
      nodeMap.set(s._id.toString(), { lat: s.lat, lng: s.lng });
    }
  }

  let bestLane: any = null;
  let bestDist = Infinity;
  let bestT = 0;

  for (const lane of lanes) {
    const fromNode = nodeMap.get(lane.from_warehouse_id.toString());
    const toNode = nodeMap.get(lane.to_warehouse_id.toString());
    if (!fromNode || !toNode) continue;

    const { distMeters, t } = projectPointToSegmentMeters(
      lat,
      lng,
      fromNode.lat,
      fromNode.lng,
      toNode.lat,
      toNode.lng,
    );

    if (distMeters <= MAX_SNAP_METERS && distMeters < bestDist) {
      bestDist = distMeters;
      bestLane = lane;
      bestT = t;
    }
  }

  if (bestLane) {
    const kmOnLane = Math.round(bestT * bestLane.distance_km * 10) / 10;
    return {
      lane_id: bestLane._id.toString(),
      km_on_lane: kmOnLane,
    };
  }

  return { lane_id: null, km_on_lane: null };
}

/**
 * Checks rate limit (max 60 pings/min/driver).
 */
export function checkRateLimit(driverId: string, pingCount: number = 1): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000;
  let timestamps = rateLimitMap.get(driverId) || [];

  // Prune older than 1 minute
  timestamps = timestamps.filter((t) => now - t < windowMs);

  if (timestamps.length + pingCount > 60) {
    rateLimitMap.set(driverId, timestamps);
    return false; // Rate limit exceeded
  }

  for (let i = 0; i < pingCount; i++) {
    timestamps.push(now);
  }
  rateLimitMap.set(driverId, timestamps);
  return true;
}

/**
 * Intakes an array of driver pings for a specific driver and truck.
 */
export async function intakeDriverPings(
  driverId: string,
  truckId: string,
  inputPings: InputPing[],
): Promise<IntakeResult> {
  // Sort incoming batch by seq
  const sorted = [...inputPings].sort((a, b) => a.seq - b.seq);

  let acceptedCount = 0;
  let duplicateCount = 0;
  const processedDocs: any[] = [];

  // Look up shipment to detect geofence arrivals
  const shipment = await Shipment.findOne({ code: truckId }).populate('warehouse_id');
  const destWh = shipment?.warehouse_id as any;

  for (const item of sorted) {
    const existing = await DriverPing.findOne({
      driver_id: driverId,
      seq: item.seq,
    });

    if (existing) {
      duplicateCount++;
      processedDocs.push({
        driver_id: driverId,
        truck_id: truckId,
        seq: item.seq,
        status: 'DUPLICATE',
      });
      continue;
    }

    const prev = await DriverPing.findOne({ driver_id: driverId }).sort({ seq: -1 }).lean();
    const verdict = validateFix(
      {
        seq: item.seq,
        ts: item.ts,
        lat: item.lat,
        lng: item.lng,
        accuracy_m: item.accuracy_m ?? null,
        speed_kmh: item.speed_kmh,
        heading: item.heading ?? null,
      },
      prev ? { ts: prev.ts, lat: prev.lat, lng: prev.lng } : null,
    );
    if (!verdict.ok) {
      processedDocs.push({
        driver_id: driverId,
        truck_id: truckId,
        seq: item.seq,
        status: 'REJECTED',
        reason: verdict.reason,
      });
      continue;
    }

    const { lane_id, km_on_lane } = await snapPingToLane(item.lat, item.lng);

    const doc = await DriverPing.create({
      driver_id: driverId,
      truck_id: truckId,
      seq: item.seq,
      ts: new Date(item.ts),
      lat: item.lat,
      lng: item.lng,
      lane_id,
      km_on_lane,
      speed_kmh: verdict.speed_kmh,
      accuracy_m: item.accuracy_m ?? null,
      heading: item.heading ?? null,
      source: item.source || 'DRIVER_DEVICE',
      created_at: new Date(),
    });

    acceptedCount++;
    processedDocs.push(doc);

    // Geofence check
    if (shipment && destWh && destWh.lat !== undefined && destWh.lng !== undefined) {
      const distKm = haversineDistanceKm(item.lat, item.lng, destWh.lat, destWh.lng);
      const distM = distKm * 1000;

      if (distM <= GEOFENCE_RADIUS_M) {
        // Write ARRIVED_GEOFENCE event once
        const existingEvent = await ShipmentEvent.findOne({
          shipment_id: shipment._id,
          event_type: 'ARRIVED_GEOFENCE',
        });

        if (!existingEvent) {
          await ShipmentEvent.create({
            shipment_id: shipment._id,
            source: item.source === 'SIM' ? 'SIM' : 'DRIVER_DEVICE',
            external_event_id: `GEOFENCE-${driverId}-${item.seq}`,
            event_type: 'ARRIVED_GEOFENCE',
            reported_eta: null,
            quantity_affected: null,
            confidence: 1.0,
            raw_payload: {
              truck_id: truckId,
              driver_id: driverId,
              lat: item.lat,
              lng: item.lng,
              seq: item.seq,
              warehouse_code: destWh.code,
            },
            ingested_at: new Date(),
          });

          // Broadcast alert to warehouse operator
          await broadcastToTopic('alerts', {
            type: 'ARRIVED_GEOFENCE',
            truck_id: truckId,
            warehouse_id: destWh.code,
            driver_id: driverId,
            message: `Truck ${truckId} arrived inside geofence of ${destWh.code}`,
          });
        }
      }
    }

    // Broadcast position update
    await broadcastToTopic('tracking', {
      type: 'TRUCK_POSITION',
      driver_id: driverId,
      truck_id: truckId,
      seq: item.seq,
      ts: item.ts,
      lat: item.lat,
      lng: item.lng,
      lane_id,
      km_on_lane,
      speed_kmh: item.speed_kmh,
      warehouse_id: destWh ? destWh.code : null,
      source: item.source || 'DRIVER_DEVICE',
    });
  }

  return {
    accepted: acceptedCount,
    duplicates: duplicateCount,
    pings: processedDocs,
  };
}

/**
 * Advances the simulation by N minutes for all active trucks (DEMO_MODE).
 */
export async function advanceSimulation(minutes: number = 5): Promise<any[]> {
  const current = await simClock.now();
  const nextTime = new Date(current.getTime() + minutes * 60000);
  simClock.set(nextTime);
  const now = await simClock.now();

  const driverUsers = await User.find({ role: 'DRIVER', truck_id: { $ne: null } }).lean();
  const results: any[] = [];

  const warehouses = await Warehouse.find({}).lean();
  const suppliers = await Supplier.find({}).lean();
  const whMap = new Map<string, any>();
  for (const w of warehouses) whMap.set(w._id.toString(), w);
  for (const s of suppliers) whMap.set(s._id.toString(), s);

  for (const driver of driverUsers) {
    const driverId = driver.driver_id!;
    const truckId = driver.truck_id!;

    // Find latest ping
    const latestPing = await DriverPing.findOne({ driver_id: driverId }).sort({ seq: -1 }).lean();
    const nextSeq = latestPing ? latestPing.seq + 1 : 1;

    // Find shipment and associated route
    const shipment = await Shipment.findOne({ code: truckId }).lean();
    if (!shipment) continue;

    const fromNode = whMap.get(shipment.supplier_id.toString()) || whMap.get(shipment.warehouse_id.toString());
    const toNode = whMap.get(shipment.warehouse_id.toString());

    if (!fromNode || !toNode) continue;

    const speedKmh = 60; // 60 km/h = 1 km/min
    const distanceToMoveKm = (speedKmh * minutes) / 60;

    let newKm = 0;
    let totalLaneKm = 100;

    // Find lane
    const lane = await TransferLane.findOne({
      $or: [
        { from_warehouse_id: shipment.warehouse_id },
        { to_warehouse_id: shipment.warehouse_id },
      ],
    }).lean();

    if (lane) {
      totalLaneKm = lane.distance_km;
      const prevKm = latestPing?.km_on_lane ?? 0;
      newKm = Math.min(totalLaneKm, prevKm + distanceToMoveKm);
    } else {
      const prevKm = latestPing?.km_on_lane ?? 0;
      newKm = prevKm + distanceToMoveKm;
    }

    const t = Math.max(0, Math.min(1, newKm / totalLaneKm));
    const newLat = fromNode.lat + t * (toNode.lat - fromNode.lat);
    const newLng = fromNode.lng + t * (toNode.lng - fromNode.lng);

    const pingRes = await intakeDriverPings(driverId, truckId, [
      {
        seq: nextSeq,
        ts: now,
        lat: Math.round(newLat * 10000) / 10000,
        lng: Math.round(newLng * 10000) / 10000,
        speed_kmh: speedKmh,
        source: 'SIM',
      },
    ]);

    results.push({
      driver_id: driverId,
      truck_id: truckId,
      seq: nextSeq,
      lat: newLat,
      lng: newLng,
      km_on_lane: newKm,
      status: pingRes.accepted > 0 ? 'ACCEPTED' : 'DUPLICATE',
    });
  }

  return results;
}
