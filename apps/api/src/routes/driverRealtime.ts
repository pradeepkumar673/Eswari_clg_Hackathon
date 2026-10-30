/**
 * apps/api/src/routes/driverRealtime.ts
 *
 * Driver-facing routes that depend on real GPS:
 *   GET  /driver/route-options          destinations ranked by distance and demand, from the truck's latest real fix
 *   POST /driver/route-select           driver picks a destination; creates a PENDING reroute proposal (manager approves)
 *   GET  /driver/assist                 pending breakdown-assist requests for this driver (reload after reconnect)
 *   POST /driver/assist/:id/respond     accept or decline an assist request
 *
 * Every route is driver-scoped: a driver only ever sees their own truck and the assists addressed to them.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { DriverPing } from '../models/driver-pings.js';
import { RerouteProposal } from '../models/reroute-proposals.js';
import { Shipment } from '../models/shipments.js';
import { Warehouse } from '../models/warehouses.js';
import { AssistAssignment } from '../models/assist-assignments.js';
import { broadcastToTopic } from '../services/websocket.js';
import { distanceKmPrecise } from '../services/gpsFix.js';

export const driverRealtimeRouter = Router();

const ROAD_FACTOR = 1.3;
const AVG_SPEED_KMH = 50;

async function latestFixFor(truckId: string): Promise<any | null> {
  return DriverPing.findOne({ truck_id: truckId }).sort({ seq: -1 }).lean();
}

// ── GET /driver/route-options ───────────────────────────────────────────────
driverRealtimeRouter.get(
  '/driver/route-options',
  authenticateToken,
  requirePermission('driver.ping'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const truckId = req.user!.truck_id!;
      const fix = await latestFixFor(truckId);
      if (!fix) {
        res.status(409).json({
          error: 'NO_GPS_FIX',
          message: 'Waiting for the first GPS fix from this device. Allow location access and wait a few seconds.',
        });
        return;
      }

      const shipment: any = await Shipment.findOne({ code: truckId }).lean();
      const warehouses: any[] = await Warehouse.find({}).lean();

      const options = await Promise.all(
        warehouses
          .filter((w) => w.lat != null && w.lng != null)
          .map(async (w) => {
            const straightKm = distanceKmPrecise(fix.lat, fix.lng, w.lat, w.lng);
            const roadKm = Math.round(straightKm * ROAD_FACTOR * 10) / 10;
            const etaMinutes = Math.round((roadKm / AVG_SPEED_KMH) * 60);
            // Demand: open inbound shipments at this warehouse (the driver's own shipment counts too)
            const inbound = await Shipment.countDocuments({ warehouse_id: w._id });
            // Ranking: more demand and shorter trips score higher
            const score = Math.round((inbound / Math.max(1, roadKm / 50)) * 100) / 100;
            return {
              warehouse_code: w.code,
              name: w.name,
              lat: w.lat,
              lng: w.lng,
              road_km: roadKm,
              eta_minutes: etaMinutes,
              inbound_shipments: inbound,
              score,
              is_current: shipment ? String(shipment.warehouse_id) === String(w._id) : false,
            };
          }),
      );

      options.sort((a, b) => b.score - a.score);
      const topScore = options[0]?.score ?? 0;

      res.json({
        truck_id: truckId,
        from: { lat: fix.lat, lng: fix.lng, ts: fix.ts, seq: fix.seq },
        distance_method: 'STRAIGHT_LINE_X1.3',
        options: options.map((o) => ({ ...o, recommended: o.score === topScore && topScore > 0 })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /driver/route-select ───────────────────────────────────────────────
driverRealtimeRouter.post(
  '/driver/route-select',
  authenticateToken,
  requirePermission('driver.ping'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const truckId = user.truck_id!;
      const { warehouse_code } = req.body;

      if (!warehouse_code) {
        res.status(400).json({ error: 'Bad Request', message: 'warehouse_code is required' });
        return;
      }

      const wh: any = await Warehouse.findOne({ code: warehouse_code }).lean();
      if (!wh || wh.lat == null) {
        res.status(404).json({ error: 'Not Found', message: `Warehouse ${warehouse_code} not found` });
        return;
      }

      const fix = await latestFixFor(truckId);
      if (!fix) {
        res.status(409).json({ error: 'NO_GPS_FIX', message: 'No GPS fix yet for this truck' });
        return;
      }

      const roadKm =
        Math.round(distanceKmPrecise(fix.lat, fix.lng, wh.lat, wh.lng) * ROAD_FACTOR * 10) / 10;

      // Driver choice is a proposal, not an immediate change. Managers still approve it.
      const proposal = await RerouteProposal.create({
        proposal_id: `PROP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        truck_id: truckId,
        from_position: {
          seq: fix.seq,
          lat: fix.lat,
          lng: fix.lng,
          ts: fix.ts,
          lane_id: fix.lane_id ?? null,
          km_on_lane: fix.km_on_lane ?? null,
        },
        nearest_warehouse_id: wh.code,
        road_km: roadKm,
        path: [],
        method: 'STRAIGHT_LINE_ESTIMATE',
        status: 'PENDING',
        proposed_by: user.username,
        reason: `DRIVER_SELECTED_ROUTE -> ${wh.code}`,
        created_at: new Date(),
      });

      await broadcastToTopic('alerts', {
        type: 'REROUTE_PROPOSED',
        proposal_id: proposal.proposal_id,
        truck_id: truckId,
        nearest_warehouse_id: wh.code,
        road_km: roadKm,
        source: 'DRIVER_SELECTED',
      });

      res.status(201).json({ proposal });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /driver/assist ──────────────────────────────────────────────────────
driverRealtimeRouter.get(
  '/driver/assist',
  authenticateToken,
  requirePermission('driver.ping'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const docs = await AssistAssignment.find({
        responder_driver_id: req.user!.driver_id,
        status: 'SUGGESTED',
      })
        .sort({ created_at: -1 })
        .lean();

      res.json({
        assists: docs.map((d: any) => ({ ...d.payload, status: d.status })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /driver/assist/:id/respond ─────────────────────────────────────────
driverRealtimeRouter.post(
  '/driver/assist/:id/respond',
  authenticateToken,
  requirePermission('driver.ping'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { decision } = req.body;
      if (decision !== 'ACCEPTED' && decision !== 'DECLINED') {
        res.status(400).json({ error: 'Bad Request', message: 'decision must be ACCEPTED or DECLINED' });
        return;
      }

      const doc: any = await AssistAssignment.findOne({
        assist_id: req.params.id,
        responder_driver_id: req.user!.driver_id,
      });
      if (!doc) {
        res.status(404).json({ error: 'Not Found', message: 'Assist request not found for this driver' });
        return;
      }
      if (doc.status !== 'SUGGESTED') {
        res.status(409).json({ error: 'Conflict', message: `Assist already ${doc.status}` });
        return;
      }

      doc.status = decision;
      doc.decided_at = new Date();
      await doc.save();

      if (decision === 'ACCEPTED') {
        await broadcastToTopic('driver', {
          type: 'ASSIST_ACCEPTED',
          target_driver_ids: [doc.broken_driver_id],
          assist_id: doc.assist_id,
          responder_truck_id: doc.responder_truck_id,
        });
        await broadcastToTopic('alerts', {
          type: 'ASSIST_ACCEPTED',
          assist_id: doc.assist_id,
          broken_truck_id: doc.broken_truck_id,
          responder_truck_id: doc.responder_truck_id,
        });
      }

      res.json({ ok: true, status: doc.status });
    } catch (err) {
      next(err);
    }
  },
);
