/**
 * apps/api/src/routes/incidentsLive.ts
 *   GET  /incidents/active        open breakdowns and accidents, for the map and driver portal on load
 *   POST /incidents/:id/clear     reporting driver, or Manager / Administrator, marks an incident cleared
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Capability } from '@disruptioniq/shared';
import { authenticateToken, requireAnyPermission } from '../middleware/auth.js';
import { DriverIncident } from '../models/driver-incidents.js';
import { toIncidentView, announceClear } from '../services/incidentFeed.js';

export const incidentsLiveRouter = Router();

const VIEW_CAPS: Capability[] = ['tracking.read.all', 'tracking.read.own', 'tracking.read.warehouse'];

incidentsLiveRouter.get(
  '/incidents/active',
  authenticateToken,
  requireAnyPermission(VIEW_CAPS),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const u = req.user!;
      const filter: Record<string, any> = { status: 'REPORTED' };
      if (u.role === 'Warehouse_Operator' && u.warehouse_id) {
        filter.warehouse_id = String(u.warehouse_id);
      }
      const docs = await DriverIncident.find(filter).sort({ created_at: -1 }).limit(50).lean();
      res.json({ incidents: docs.map(toIncidentView) });
    } catch (err) {
      next(err);
    }
  },
);

incidentsLiveRouter.post(
  '/incidents/:id/clear',
  authenticateToken,
  requireAnyPermission(['driver.incident', 'reroute.decide', 'tracking.read.all']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const u = req.user!;
      const doc: any = await DriverIncident.findOne({ incident_id: req.params.id });
      if (!doc) {
        res.status(404).json({ error: 'Not Found', message: 'Incident not found' });
        return;
      }
      if (doc.status !== 'REPORTED') {
        res.status(409).json({ error: 'Conflict', message: `Incident already ${doc.status}` });
        return;
      }

      const isReportingDriver = u.role.toUpperCase() === 'DRIVER' && u.driver_id === doc.driver_id;
      const isManager = u.role === 'Manager' || u.role === 'Administrator';
      if (!isReportingDriver && !isManager) {
        res.status(403).json({ error: 'Forbidden', message: 'Only the reporting driver or a manager can clear this incident' });
        return;
      }

      doc.status = 'CLEARED';
      doc.cleared_at = new Date();
      doc.cleared_by = u.username;
      await doc.save();

      await announceClear(toIncidentView(doc), u.username);
      res.json({ ok: true, incident_id: doc.incident_id });
    } catch (err) {
      next(err);
    }
  },
);
