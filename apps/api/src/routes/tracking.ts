/**
 * apps/api/src/routes/tracking.ts
 *
 * Live Driver Tracking, Graph Dijkstra, Incidents, Reroute Approvals & Simulator Tick.
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import { DriverPing } from '../models/driver-pings.js';
import { DriverIncident } from '../models/driver-incidents.js';
import { RerouteProposal } from '../models/reroute-proposals.js';
import { Shipment } from '../models/shipments.js';
import { Warehouse } from '../models/warehouses.js';
import { TransferLane } from '../models/transfer-lanes.js';
import { User } from '../models/users.js';
import { writeLedgerEntry } from '../services/audit.js';
import { broadcastToTopic } from '../services/websocket.js';
import { findNearestWarehouse } from '../services/nearestWarehouse.js';
import {
  intakeDriverPings,
  checkRateLimit,
  advanceSimulation,
  InputPing,
} from '../services/driverSimulator.js';
import { config } from '../config.js';
import { matchAssistResponders } from '../services/assistMatcher.js';
import { distanceKmPrecise } from '../services/gpsFix.js';
import { announceIncident, toIncidentView } from '../services/incidentFeed.js';

export const trackingRouter = Router();

// ── GET /tracking/positions ───────────────────────────────────────────────
trackingRouter.get(
  '/tracking/positions',
  authenticateToken,
  requireAnyPermission(['tracking.read.all', 'tracking.read.warehouse', 'tracking.read.own']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const filter: Record<string, any> = {};

      if (user.role.toUpperCase() === 'DRIVER') {
        if (!user.driver_id && !user.truck_id) {
          res.status(403).json({ error: 'Forbidden', message: 'Driver has no bound truck' });
          return;
        }
        filter.driver_id = user.driver_id;
      } else if (user.role === 'Warehouse_Operator') {
        const queryWh = req.query.warehouse_id as string | undefined;
        if (queryWh && user.warehouse_id) {
          const userWhDoc = await Warehouse.findById(user.warehouse_id).lean();
          const matches =
            user.warehouse_id.toString() === queryWh ||
            (userWhDoc && userWhDoc.code === queryWh);
          if (!matches) {
            res.status(403).json({ error: 'Forbidden', message: 'Operator restricted to assigned warehouse' });
            return;
          }
        }
      }

      if (req.query.truck_id) {
        filter.truck_id = req.query.truck_id;
      }
      if (req.query.driver_id) {
        filter.driver_id = req.query.driver_id;
      }

      const pings = await DriverPing.find(filter).sort({ seq: -1 }).limit(100).lean();
      res.json(pings);
    } catch (e) {
      next(e);
    }
  },
);

// ── GET /tracking/drivers/:driver_id/positions ─────────────────────────────
trackingRouter.get(
  '/tracking/drivers/:driver_id/positions',
  authenticateToken,
  requireAnyPermission(['tracking.read.all', 'tracking.read.warehouse', 'tracking.read.own']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const targetDriverId = req.params.driver_id;

      if (user.role.toUpperCase() === 'DRIVER') {
        if (user.driver_id !== targetDriverId) {
          res.status(403).json({ error: 'Forbidden', message: 'Driver can only read own positions' });
          return;
        }
      }

      const pings = await DriverPing.find({ driver_id: targetDriverId }).sort({ seq: -1 }).limit(100).lean();
      res.json(pings);
    } catch (e) {
      next(e);
    }
  },
);

// ── 1. GET /tracking/trucks ──────────────────────────────────────────────────
trackingRouter.get(
  '/tracking/trucks',
  authenticateToken,
  requireAnyPermission(['tracking.read.all', 'tracking.read.warehouse', 'tracking.read.own']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const roleUpper = user.role.toUpperCase();

      let query: any = {};
      if (roleUpper === 'DRIVER') {
        const truckId = user.truck_id;
        query = { truck_id: truckId };
      }

      const driverUsers = await User.find({ role: 'DRIVER', truck_id: { $ne: null } }).lean();
      const trucksData: any[] = [];

      const warehouses = await Warehouse.find({}).lean();
      const whMap = new Map<string, any>();
      for (const w of warehouses) whMap.set(w._id.toString(), w);

      for (const drv of driverUsers) {
        if (roleUpper === 'DRIVER' && drv.truck_id !== user.truck_id) {
          continue;
        }

        const shipment = await Shipment.findOne({ code: drv.truck_id }).lean();
        const destWh = shipment ? whMap.get(shipment.warehouse_id.toString()) : null;

        // Operator scoping
        if (user.role === 'Warehouse_Operator' && user.warehouse_id) {
          const userWhDoc = await Warehouse.findById(user.warehouse_id).lean();
          if (
            destWh &&
            destWh._id.toString() !== user.warehouse_id.toString() &&
            destWh.code !== userWhDoc?.code
          ) {
            continue;
          }
        }

        const latestPing = await DriverPing.findOne({ driver_id: drv.driver_id })
          .sort({ seq: -1 })
          .lean();

        const activeIncident = await DriverIncident.findOne({
          truck_id: drv.truck_id,
          status: 'REPORTED',
        })
          .sort({ created_at: -1 })
          .lean();

        const pendingProposal = await RerouteProposal.findOne({
          truck_id: drv.truck_id,
          status: 'PENDING',
        })
          .sort({ created_at: -1 })
          .lean();

        trucksData.push({
          truck_id: drv.truck_id,
          driver_id: drv.driver_id,
          driver_name: drv.display_name,
          position: latestPing
            ? {
                lat: latestPing.lat,
                lng: latestPing.lng,
                speed_kmh: latestPing.speed_kmh,
                lane_id: latestPing.lane_id,
                km_on_lane: latestPing.km_on_lane,
                method: latestPing.lane_id ? 'ROAD_GRAPH' : 'STRAIGHT_LINE_ESTIMATE',
                ts: latestPing.ts,
                seq: latestPing.seq,
              }
            : null,
          destination_warehouse: destWh
            ? {
                id: destWh._id.toString(),
                code: destWh.code,
                name: destWh.name,
                lat: destWh.lat,
                lng: destWh.lng,
              }
            : null,
          active_incident: activeIncident
            ? {
                incident_id: activeIncident.incident_id,
                kind: activeIncident.kind,
                ts: activeIncident.ts,
              }
            : null,
          pending_proposal: pendingProposal
            ? {
                proposal_id: pendingProposal.proposal_id,
                nearest_warehouse_id: pendingProposal.nearest_warehouse_id,
                road_km: pendingProposal.road_km,
                status: pendingProposal.status,
              }
            : null,
        });
      }

      res.json({ trucks: trucksData });
    } catch (err) {
      next(err);
    }
  },
);

// ── 2. GET /tracking/trucks/:id/route ─────────────────────────────────────────
trackingRouter.get(
  '/tracking/trucks/:id/route',
  authenticateToken,
  requireAnyPermission(['tracking.read.all', 'tracking.read.warehouse', 'tracking.read.own']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const truckId = req.params.id;
      const shipment = await Shipment.findOne({ code: truckId }).lean();
      if (!shipment) {
        res.status(404).json({ error: 'Not Found', message: `Truck ${truckId} not found` });
        return;
      }

      const destWh = await Warehouse.findById(shipment.warehouse_id).lean();
      const lanes = await TransferLane.find({}).lean();
      const warehouses = await Warehouse.find({}).lean();

      res.json({
        truck_id: truckId,
        destination: destWh,
        transfer_lanes: lanes,
        warehouses,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── 3. POST /driver/pings ────────────────────────────────────────────────────
trackingRouter.post(
  '/driver/pings',
  authenticateToken,
  requirePermission('driver.ping'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const driverId = user.driver_id || 'DRV-1';
      const truckId = user.truck_id || 'SHP-204';

      // Scoping: Driver cannot post for another truck
      if (req.body.truck_id && req.body.truck_id !== truckId) {
        res.status(403).json({
          error: 'Forbidden',
          message: `Driver ${driverId} is bound to truck ${truckId} and cannot ping for ${req.body.truck_id}`,
        });
        return;
      }

      // Extract pings array
      const rawPings: InputPing[] = Array.isArray(req.body)
        ? req.body
        : Array.isArray(req.body.pings)
          ? req.body.pings
          : [req.body];

      if (rawPings.length === 0) {
        res.status(400).json({ error: 'Bad Request', message: 'No pings provided' });
        return;
      }

      if (rawPings.length > 100) {
        res.status(400).json({ error: 'Bad Request', message: 'Batch cannot exceed 100 pings' });
        return;
      }

      // Check rate limit: 60 pings/min/driver
      const allowed = checkRateLimit(driverId, rawPings.length);
      if (!allowed) {
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded: maximum 60 pings per minute per driver',
        });
        return;
      }

      const result = await intakeDriverPings(driverId, truckId, rawPings);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ── 4. POST /driver/incidents ────────────────────────────────────────────────
trackingRouter.post(
  '/driver/incidents',
  authenticateToken,
  requirePermission('driver.incident'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user: any = req.user!;
      const driverId = user.driver_id || 'DRV-1';
      const truckId = user.truck_id || 'SHP-204';
      const driverName: string = user.display_name || user.username || driverId;

      const { kind, idempotency_key, ts, gps } = req.body;
      if (!kind || !idempotency_key) {
        res.status(400).json({ error: 'Bad Request', message: 'kind and idempotency_key are required' });
        return;
      }
      if (!['BREAKDOWN', 'ACCIDENT', 'DELAY_OTHER'].includes(kind)) {
        res.status(400).json({ error: 'Bad Request', message: `Unknown incident kind ${kind}` });
        return;
      }
      if (req.body.truck_id && req.body.truck_id !== truckId) {
        res.status(403).json({ error: 'Forbidden', message: 'Cannot report incident for another truck' });
        return;
      }

      // Idempotency: a repeated tap returns the original incident
      const existing = await DriverIncident.findOne({ driver_id: driverId, idempotency_key });
      if (existing) {
        const existingProp = await RerouteProposal.findOne({ reason: { $regex: idempotency_key } });
        res.status(200).json({ incident: existing, proposal: existingProp });
        return;
      }

      // 1. Record the live GPS fix sent with the report, so the position is the moment of the press
      if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)) {
        const last: any = await DriverPing.findOne({ driver_id: driverId }).sort({ seq: -1 }).lean();
        await intakeDriverPings(driverId, truckId, [
          {
            seq: (last?.seq ?? 0) + 1,
            ts: gps.ts ?? new Date(),
            lat: gps.lat,
            lng: gps.lng,
            speed_kmh: 0,
            accuracy_m: gps.accuracy_m ?? null,
            source: 'DRIVER_DEVICE',
          } as any,
        ]);
      }
      const fresh: any = await DriverPing.findOne({ driver_id: driverId }).sort({ seq: -1 }).lean();

      // 2. Destination for context on the map and in the notification
      const shipment: any = await Shipment.findOne({ code: truckId }).lean();
      const dest: any = shipment ? await Warehouse.findById(shipment.warehouse_id).lean() : null;

      const incidentId = `INC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const incident: any = await DriverIncident.create({
        incident_id: incidentId,
        driver_id: driverId,
        driver_name: driverName,
        truck_id: truckId,
        kind,
        ts: ts ? new Date(ts) : new Date(),
        status: 'REPORTED',
        lat: fresh?.lat ?? null,
        lng: fresh?.lng ?? null,
        accuracy_m: fresh?.accuracy_m ?? null,
        warehouse_id: shipment ? String(shipment.warehouse_id) : null,
        destination_code: dest?.code ?? null,
        proposal_id: null,
        idempotency_key,
        created_at: new Date(),
      });

      // 3. Reroute proposal and assist matching for breakdowns and accidents
      let proposal: any = null;
      if (kind === 'BREAKDOWN' || kind === 'ACCIDENT') {
        const nearest = await findNearestWarehouse({
          lane_id: fresh?.lane_id,
          km_on_lane: fresh?.km_on_lane,
          lat: fresh?.lat ?? 12.7409,
          lng: fresh?.lng ?? 77.8253,
        });

        const proposalId = `PROP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        proposal = await RerouteProposal.create({
          proposal_id: proposalId,
          truck_id: truckId,
          from_position: {
            seq: fresh?.seq ?? 0,
            lat: fresh?.lat ?? 12.7409,
            lng: fresh?.lng ?? 77.8253,
            lane_id: fresh?.lane_id ?? null,
            km_on_lane: fresh?.km_on_lane ?? null,
          },
          nearest_warehouse_id: nearest.nearest_warehouse_code,
          road_km: nearest.road_km,
          path: nearest.path,
          method: nearest.method,
          status: 'PENDING',
          proposed_by: user.username,
          reason: `${kind} (${idempotency_key})`,
          created_at: new Date(),
        });

        await DriverIncident.updateOne({ incident_id: incidentId }, { $set: { proposal_id: proposalId } });

        await broadcastToTopic('alerts', {
          type: 'REROUTE_PROPOSED',
          proposal_id: proposalId,
          truck_id: truckId,
          nearest_warehouse_id: nearest.nearest_warehouse_code,
          road_km: nearest.road_km,
        });

        if (fresh) {
          await matchAssistResponders(
            { incident_id: incidentId, kind, truck_id: truckId, driver_id: driverId, driver_name: driverName },
            { lat: fresh.lat, lng: fresh.lng, ts: fresh.ts },
          );
        }
      }

      // 4. Live map for everyone, and the bell for managers and admins
      await announceIncident(
        toIncidentView({ ...incident.toObject(), proposal_id: proposal?.proposal_id ?? null }),
      );

      res.status(201).json({ incident, proposal });
    } catch (err: any) {
      if (err.code === 11000) {
        const existing = await DriverIncident.findOne({
          driver_id: (req.user as any)?.driver_id || 'DRV-1',
          idempotency_key: req.body.idempotency_key,
        });
        const existingProp = await RerouteProposal.findOne({ reason: { $regex: req.body.idempotency_key } });
        res.status(200).json({ incident: existing, proposal: existingProp });
        return;
      }
      next(err);
    }
  },
);

// ── 5. GET /reroutes ─────────────────────────────────────────────────────────
trackingRouter.get(
  '/reroutes',
  authenticateToken,
  requireAnyPermission(['reroute.decide', 'tracking.read.all', 'tracking.read.warehouse', 'tracking.read.own']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filter: any = {};
      if (req.query.status) filter.status = req.query.status;
      if (req.query.truck_id) filter.truck_id = req.query.truck_id;

      const proposals = await RerouteProposal.find(filter)
        .sort({ created_at: -1 })
        .lean();
      res.json({ proposals });
    } catch (err) {
      next(err);
    }
  },
);

// ── 6. POST /reroutes/:id/approve ────────────────────────────────────────────
trackingRouter.post(
  '/reroutes/:id/approve',
  authenticateToken,
  requirePermission('reroute.decide'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;

      // Supply Chain Manager only (Administrators and Operators cannot approve)
      if (user.role !== 'Manager') {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Only Supply Chain Managers can approve truck reroute proposals',
        });
        return;
      }

      const proposal = await RerouteProposal.findOne({
        $or: [
          { proposal_id: req.params.id },
          ...(mongoose.Types.ObjectId.isValid(req.params.id) ? [{ _id: req.params.id }] : []),
        ],
      });

      if (!proposal) {
        res.status(404).json({ error: 'Not Found', message: 'Reroute proposal not found' });
        return;
      }

      // Separation of duties: Reporter cannot approve
      if (
        proposal.proposed_by === user.username ||
        (user.driver_id && proposal.proposed_by === user.driver_id)
      ) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Separation of duties violation: Reporter cannot approve their own proposal',
        });
        return;
      }

      // Check if truck moved since proposal
      const ageMin = (Date.now() - new Date(proposal.created_at).getTime()) / 60000;
      const latest = await DriverPing.findOne({ truck_id: proposal.truck_id }).sort({ seq: -1 }).lean();
      const movedKm = latest && proposal.from_position?.lat != null
        ? distanceKmPrecise(proposal.from_position.lat, proposal.from_position.lng, latest.lat, latest.lng)
        : 0;

      if (ageMin > 15 || movedKm > 2) {
        proposal.status = 'STALE';
        await proposal.save();
        res.status(409).json({
          error: 'Conflict',
          message: 'Proposal is older than 15 minutes or the truck moved more than 2 km; re-submit',
          status: 'STALE',
        });
        return;
      }

      // Change destination
      const targetWh = await Warehouse.findOne({ code: proposal.nearest_warehouse_id });
      const shipment = await Shipment.findOne({ code: proposal.truck_id });

      const prevDestination = shipment ? shipment.warehouse_id.toString() : null;
      if (shipment && targetWh) {
        shipment.warehouse_id = targetWh._id;
        await shipment.save();
      }

      proposal.status = 'EXECUTED_SIMULATED';
      proposal.decided_by = user.username;
      await proposal.save();

      // Write execution ledger entry (action REROUTE_SIMULATED)
      await writeLedgerEntry({
        stepType: 'REROUTE_SIMULATED',
        actor: user._id,
        beforeState: {
          truck_id: proposal.truck_id,
          destination: prevDestination,
          proposal_id: proposal.proposal_id,
        },
        afterState: {
          truck_id: proposal.truck_id,
          destination: targetWh ? targetWh._id.toString() : proposal.nearest_warehouse_id,
          proposal_id: proposal.proposal_id,
          status: 'EXECUTED_SIMULATED',
        },
      });

      // Publish REROUTE_EXECUTED
      await broadcastToTopic('tracking', {
        type: 'REROUTE_EXECUTED',
        proposal_id: proposal.proposal_id,
        truck_id: proposal.truck_id,
        new_destination: proposal.nearest_warehouse_id,
        road_km: proposal.road_km,
      });

      const driverUser: any = await User.findOne({ truck_id: proposal.truck_id, role: 'DRIVER' }).lean();
      if (driverUser?.driver_id) {
        await broadcastToTopic('driver', {
          type: 'REROUTE_DECIDED',
          target_driver_ids: [driverUser.driver_id],
          proposal_id: proposal.proposal_id,
          decision: 'APPROVED',
          warehouse_code: targetWh?.code ?? proposal.nearest_warehouse_id,
          warehouse_name: targetWh?.name ?? null,
          lat: targetWh?.lat ?? null,
          lng: targetWh?.lng ?? null,
        });
      }

      res.status(200).json({ success: true, proposal });
    } catch (err) {
      next(err);
    }
  },
);

// ── 7. POST /reroutes/:id/reject ─────────────────────────────────────────────
trackingRouter.post(
  '/reroutes/:id/reject',
  authenticateToken,
  requirePermission('reroute.decide'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      if (user.role !== 'Manager') {
        res.status(403).json({ error: 'Forbidden', message: 'Only Managers can reject proposals' });
        return;
      }

      const { reason } = req.body;
      if (!reason) {
        res.status(400).json({ error: 'Bad Request', message: 'Rejection reason is required' });
        return;
      }

      const proposal = await RerouteProposal.findOne({
        $or: [
          { proposal_id: req.params.id },
          ...(mongoose.Types.ObjectId.isValid(req.params.id) ? [{ _id: req.params.id }] : []),
        ],
      });

      if (!proposal) {
        res.status(404).json({ error: 'Not Found', message: 'Proposal not found' });
        return;
      }

      proposal.status = 'REJECTED';
      proposal.decided_by = user.username;
      proposal.reason = `${proposal.reason} | Rejected: ${reason}`;
      await proposal.save();

      const rejectedDriver: any = await User.findOne({ truck_id: proposal.truck_id, role: 'DRIVER' }).lean();
      if (rejectedDriver?.driver_id) {
        await broadcastToTopic('driver', {
          type: 'REROUTE_DECIDED',
          target_driver_ids: [rejectedDriver.driver_id],
          proposal_id: proposal.proposal_id,
          decision: 'REJECTED',
          reason,
        });
      }

      res.status(200).json({ success: true, proposal });
    } catch (err) {
      next(err);
    }
  },
);

// ── 8. GET /tracking/nearest ─────────────────────────────────────────────────
trackingRouter.get(
  '/tracking/nearest',
  authenticateToken,
  requireAnyPermission(['tracking.read.all', 'tracking.read.warehouse', 'tracking.read.own', 'reroute.decide']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const truckId = req.query.truck_id as string;
      if (!truckId) {
        res.status(400).json({ error: 'Bad Request', message: 'truck_id query param is required' });
        return;
      }

      const latestPing = await DriverPing.findOne({ truck_id: truckId })
        .sort({ seq: -1 })
        .lean();

      const nearest = await findNearestWarehouse({
        lane_id: latestPing?.lane_id,
        km_on_lane: latestPing?.km_on_lane,
        lat: latestPing?.lat,
        lng: latestPing?.lng,
      });

      res.json({ truck_id: truckId, ...nearest });
    } catch (err) {
      next(err);
    }
  },
);

// ── 9. POST /admin/sim/tick ──────────────────────────────────────────────────
trackingRouter.post(
  '/admin/sim/tick',
  authenticateToken,
  requirePermission('run_stress_test'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      if (user.role !== 'Administrator') {
        res.status(403).json({ error: 'Forbidden', message: 'Only Administrators can tick simulation' });
        return;
      }

      if (!config.DEMO_MODE) {
        res.status(400).json({ error: 'Bad Request', message: 'Simulation tick is only available in DEMO_MODE' });
        return;
      }

      const minutes = Number(req.body.minutes) || 5;
      const movedTrucks = await advanceSimulation(minutes);

      res.json({
        ok: true,
        minutes_advanced: minutes,
        trucks: movedTrucks,
      });
    } catch (err) {
      next(err);
    }
  },
);
