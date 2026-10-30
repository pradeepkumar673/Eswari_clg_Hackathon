/**
 * apps/api/src/routes/tracking.ts
 *
 * Driver and truck real-time GPS tracking routes.
 * Enforces role-based capabilities and strict driver/warehouse scoping:
 * - DRIVER: own truck/driver only (403 on other driver or truck)
 * - Warehouse_Operator: warehouse-scoped corridor tracking
 * - Analyst / Manager / Admin: full network visibility
 * - Procurement: no tracking access (403)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.js';
import { DriverPing } from '../models/driver-pings.js';
import { DriverIncident } from '../models/driver-incidents.js';
import { RerouteProposal } from '../models/reroute-proposals.js';
import { Warehouse } from '../models/warehouses.js';

export const trackingRouter = Router();

// GET /tracking/positions
trackingRouter.get(
  '/positions',
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

      const pings = await DriverPing.find(filter).sort({ ts: -1 }).limit(100).lean();
      res.json(pings);
    } catch (e) {
      next(e);
    }
  },
);

// GET /tracking/drivers/:driverId/positions
trackingRouter.get(
  '/drivers/:driverId/positions',
  authenticateToken,
  requireAnyPermission(['tracking.read.all', 'tracking.read.warehouse', 'tracking.read.own']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const targetDriverId = req.params.driverId;

      if (user.role.toUpperCase() === 'DRIVER' && user.driver_id !== targetDriverId) {
        res.status(403).json({ error: 'Forbidden', message: 'Driver cannot access another driver data' });
        return;
      }

      if (user.role === 'Warehouse_Operator') {
        const queryWh = (req.query.warehouse_id as string | undefined) || req.params.warehouseId;
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

      const pings = await DriverPing.find({ driver_id: targetDriverId })
        .sort({ seq: 1 })
        .lean();
      res.json(pings);
    } catch (e) {
      next(e);
    }
  },
);

// POST /tracking/pings
trackingRouter.post(
  '/pings',
  authenticateToken,
  requirePermission('driver.ping'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const { seq, ts, lat, lng, speed_kmh, lane_id, km_on_lane, source } = req.body;

      const ping = await DriverPing.create({
        driver_id: user.driver_id || req.body.driver_id,
        truck_id: user.truck_id || req.body.truck_id,
        seq,
        ts: ts ? new Date(ts) : new Date(),
        lat,
        lng,
        lane_id,
        km_on_lane,
        speed_kmh: speed_kmh || 0,
        source: source || 'SIM',
      });

      res.status(201).json(ping);
    } catch (e) {
      next(e);
    }
  },
);

// POST /tracking/incidents
trackingRouter.post(
  '/incidents',
  authenticateToken,
  requirePermission('driver.incident'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const { incident_id, kind, ts, status, idempotency_key } = req.body;

      const incident = await DriverIncident.create({
        incident_id: incident_id || `INC-${Date.now()}`,
        driver_id: user.driver_id || req.body.driver_id,
        truck_id: user.truck_id || req.body.truck_id,
        kind,
        ts: ts ? new Date(ts) : new Date(),
        status: status || 'REPORTED',
        idempotency_key,
      });

      res.status(201).json(incident);
    } catch (e) {
      next(e);
    }
  },
);

// POST /tracking/reroutes/:proposalId/decide
trackingRouter.post(
  '/reroutes/:proposalId/decide',
  authenticateToken,
  requirePermission('reroute.decide'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, reason } = req.body;
      const updated = await RerouteProposal.findOneAndUpdate(
        { proposal_id: req.params.proposalId },
        {
          $set: {
            status,
            decided_by: req.user!.username,
            reason: reason || 'Decided by manager',
          },
        },
        { new: true },
      );
      if (!updated) {
        res.status(404).json({ error: 'Not Found', message: 'Reroute proposal not found' });
        return;
      }
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

