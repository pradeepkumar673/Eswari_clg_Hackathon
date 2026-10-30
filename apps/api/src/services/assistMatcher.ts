/**
 * apps/api/src/services/assistMatcher.ts
 *
 * Called when a driver reports BREAKDOWN or ACCIDENT.
 *
 * A responder truck is matched when all of these hold:
 *   1. It is a different truck with a live GPS fix.
 *   2. It is within ASSIST_RADIUS_KM (default 50 km, straight line) of the broken truck.
 *   3. Either
 *        SAME_DESTINATION: it is heading to the same warehouse as the broken truck, or
 *        ON_ROUTE:          the broken truck sits within ON_ROUTE_TOLERANCE_KM of the
 *                           responder's remaining path to its warehouse (it will have to
 *                           pass the broken truck).
 *
 * Each match is stored once (deterministic assist_id) and pushed only to the
 * responder over the 'driver' WebSocket topic, which filters by target_driver_ids.
 */

import { DriverPing } from '../models/driver-pings.js';
import { Shipment } from '../models/shipments.js';
import { Warehouse } from '../models/warehouses.js';
import { User } from '../models/users.js';
import { AssistAssignment } from '../models/assist-assignments.js';
import { broadcastToTopic } from './websocket.js';
import { distanceKmPrecise } from './gpsFix.js';

export const ASSIST_RADIUS_KM = Number(process.env.ASSIST_RADIUS_KM ?? 50);
const ON_ROUTE_TOLERANCE_KM = 2;
const ROAD_FACTOR = 1.3; // straight line -> approximate road distance
const AVG_SPEED_KMH = 50; // planning speed for ETA only

export interface AssistIncident {
  incident_id: string;
  kind: 'BREAKDOWN' | 'ACCIDENT';
  truck_id: string;
  driver_id: string;
  driver_name?: string;
}

export interface BrokenFix {
  lat: number;
  lng: number;
  ts: Date;
}

/** Distance from point p to segment a-b, in km (equirectangular projection, fine at this scale). */
export function distancePointToSegmentKm(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const lat0 = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const kx = 111.32 * Math.cos(lat0);
  const ky = 110.54;

  const bx = (b.lng - a.lng) * kx;
  const by = (b.lat - a.lat) * ky;
  const px = (p.lng - a.lng) * kx;
  const py = (p.lat - a.lat) * ky;

  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

export async function matchAssistResponders(
  incident: AssistIncident,
  broken: BrokenFix,
): Promise<number> {
  const warehouses = await Warehouse.find({}).lean();
  const whById = new Map<string, any>(warehouses.map((w: any) => [w._id.toString(), w]));

  const brokenShipment = await Shipment.findOne({ code: incident.truck_id }).lean();
  const brokenDest = brokenShipment ? whById.get(String(brokenShipment.warehouse_id)) : undefined;

  const brokenTrailDocs = await DriverPing.find({ driver_id: incident.driver_id })
    .sort({ seq: -1 })
    .limit(30)
    .lean();
  const brokenTrail = brokenTrailDocs
    .reverse()
    .map((p: any) => [p.lat, p.lng] as [number, number]);

  const candidates = await User.find({
    role: 'DRIVER',
    truck_id: { $nin: [null, incident.truck_id] },
  }).lean();

  let created = 0;

  for (const drv of candidates as any[]) {
    if (!drv.driver_id || !drv.truck_id) continue;

    const fix: any = await DriverPing.findOne({ truck_id: drv.truck_id }).sort({ seq: -1 }).lean();
    if (!fix) continue;

    const straightKm = distanceKmPrecise(fix.lat, fix.lng, broken.lat, broken.lng);
    if (straightKm > ASSIST_RADIUS_KM) continue;

    const sh: any = await Shipment.findOne({ code: drv.truck_id }).lean();
    const myDest = sh ? whById.get(String(sh.warehouse_id)) : undefined;

    let reason: 'SAME_DESTINATION' | 'ON_ROUTE' | null = null;

    if (myDest && brokenDest && String(myDest._id) === String(brokenDest._id)) {
      reason = 'SAME_DESTINATION';
    } else if (myDest && myDest.lat != null && myDest.lng != null) {
      const offRouteKm = distancePointToSegmentKm(
        { lat: broken.lat, lng: broken.lng },
        { lat: fix.lat, lng: fix.lng },
        { lat: myDest.lat, lng: myDest.lng },
      );
      if (offRouteKm <= ON_ROUTE_TOLERANCE_KM) reason = 'ON_ROUTE';
    }

    if (!reason) continue;

    const roadKm = Math.round(straightKm * ROAD_FACTOR * 10) / 10;
    const etaMinutes = Math.round((roadKm / AVG_SPEED_KMH) * 60);
    const assistId = `AST-${incident.incident_id}-${drv.truck_id}`;

    const payload = {
      assist_id: assistId,
      incident_id: incident.incident_id,
      reason,
      distance_km: roadKm,
      eta_minutes: etaMinutes,
      responder: {
        truck_id: drv.truck_id,
        driver_id: drv.driver_id,
        lat: fix.lat,
        lng: fix.lng,
      },
      broken: {
        truck_id: incident.truck_id,
        driver_id: incident.driver_id,
        driver_name: incident.driver_name ?? incident.driver_id,
        kind: incident.kind,
        lat: broken.lat,
        lng: broken.lng,
        ts: broken.ts.toISOString(),
        trail: brokenTrail,
        destination: brokenDest
          ? {
              code: brokenDest.code,
              name: brokenDest.name,
              lat: brokenDest.lat,
              lng: brokenDest.lng,
            }
          : null,
      },
    };

    // Upsert keeps notifications idempotent if the incident is retried
    const upsert = await AssistAssignment.updateOne(
      { assist_id: assistId },
      {
        $setOnInsert: {
          assist_id: assistId,
          incident_id: incident.incident_id,
          broken_driver_id: incident.driver_id,
          broken_truck_id: incident.truck_id,
          responder_driver_id: drv.driver_id,
          responder_truck_id: drv.truck_id,
          reason,
          status: 'SUGGESTED',
          payload,
          created_at: new Date(),
          decided_at: null,
        },
      },
      { upsert: true },
    );

    if (upsert.upsertedCount === 0) continue;

    created++;
    await broadcastToTopic('driver', {
      type: 'ASSIST_REQUEST',
      target_driver_ids: [drv.driver_id],
      assist: { ...payload, status: 'SUGGESTED' },
    });
  }

  if (created > 0) {
    await broadcastToTopic('alerts', {
      type: 'ASSIST_MATCHED',
      incident_id: incident.incident_id,
      broken_truck_id: incident.truck_id,
      responders: created,
    });
  }

  return created;
}
