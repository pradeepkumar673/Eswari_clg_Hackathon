/**
 * apps/api/src/routes/alerts.ts
 *
 * Alert Feed and Chart Data endpoints (Step 10, B3).
 *   GET  /alerts
 *   POST /alerts/:id/ack
 *   GET  /alerts/chart/penalty-exposure
 *   GET  /alerts/chart/open-disruptions
 *   GET  /alerts/chart/import-quality
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { Alert } from '../models/alerts.js';
import { Order } from '../models/orders.js';
import { Disruption } from '../models/disruptions.js';
import { ImportBatch } from '../models/import-batches.js';
import { simClock } from '../services/simClock.js';

export const alertsRouter = Router();

function err(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

// ---------------------------------------------------------------------------
// GET /alerts — alert feed
// ---------------------------------------------------------------------------
alertsRouter.get(
  '/',
  authenticateToken,
  requirePermission('view_cockpit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const status = req.query.status as string | undefined;
      const type = req.query.type as string | undefined;
      const filter: any = {};

      if (status) {
        filter.status = status;
      } else {
        filter.status = { $in: ['OPEN', 'ACKNOWLEDGED'] };
      }
      if (type) filter.type = type;

      const alerts = await Alert.find(filter)
        .sort({ created_at: -1 })
        .limit(100)
        .lean();

      res.status(200).json({ alerts, count: alerts.length });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /alerts/:id/ack — acknowledge alert
// ---------------------------------------------------------------------------
alertsRouter.post(
  '/:id/ack',
  authenticateToken,
  requirePermission('run_detectors'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        err(res, 400, 'BAD_ID', 'Invalid alert id'); return;
      }

      const alert = await Alert.findById(id);
      if (!alert) { err(res, 404, 'NOT_FOUND', 'Alert not found'); return; }

      alert.status = 'ACKNOWLEDGED';
      await alert.save();

      res.status(200).json({ ok: true, alert_id: alert._id, status: 'ACKNOWLEDGED' });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /alerts/chart/penalty-exposure
// ---------------------------------------------------------------------------
alertsRouter.get(
  '/chart/penalty-exposure',
  authenticateToken,
  requirePermission('view_cockpit'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orders = await Order.find({ status: { $in: ['OPEN', 'RECOVERING'] } })
        .sort({ penalty_per_hour: -1 })
        .limit(20)
        .lean();

      const chartData = orders.map((o) => ({
        order_code: o.code,
        penalty_exposure: o.penalty_per_hour * o.total_units,
        penalty_per_hour: o.penalty_per_hour,
        total_units: o.total_units,
        priority: o.priority,
      }));

      res.status(200).json({ chart: chartData });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /alerts/chart/open-disruptions
// ---------------------------------------------------------------------------
alertsRouter.get(
  '/chart/open-disruptions',
  authenticateToken,
  requirePermission('view_cockpit'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const disruptions = await Disruption.find({ status: { $in: ['OPEN', 'IN_RECOVERY'] } }).lean();

      const countsByType: Record<string, number> = {};
      for (const d of disruptions) {
        countsByType[d.disruption_type] = (countsByType[d.disruption_type] || 0) + 1;
      }

      const chartData = Object.entries(countsByType).map(([type, count]) => ({
        type,
        count,
      }));

      res.status(200).json({ chart: chartData, total_open: disruptions.length });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /alerts/chart/import-quality
// ---------------------------------------------------------------------------
alertsRouter.get(
  '/chart/import-quality',
  authenticateToken,
  requirePermission('view_cockpit'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const batches = await ImportBatch.find({}).sort({ created_at: -1 }).limit(10).lean();

      const chartData = batches.map((b) => ({
        batch_id: b._id,
        entity_type: b.entity_type,
        total_rows: b.row_count,
        clean_rows: b.valid_count,
        quarantine_rows: b.quarantined_count,
        status: b.status,
      }));

      res.status(200).json({ chart: chartData });
    } catch (e) {
      next(e);
    }
  },
);
