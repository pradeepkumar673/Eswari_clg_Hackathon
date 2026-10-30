/**
 * apps/api/src/routes/shipments.ts
 *
 * Shipments endpoints and ETA Drift (Step 11, B13).
 * GET /shipments
 * GET /shipments/:id
 * GET /shipments/:id/eta-drift
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { Shipment } from '../models/shipments.js';
import { computeEtaDrift } from '../services/coverDrift.js';

export const shipmentsRouter = Router();

// GET /shipments
shipmentsRouter.get(
  '/',
  authenticateToken,
  requirePermission('view_disruptions'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const shipments = await Shipment.find({})
        .populate('supplier_id', 'code name')
        .populate('warehouse_id', 'code name')
        .sort({ created_at: -1 })
        .lean();
      res.status(200).json(shipments);
    } catch (e) {
      next(e);
    }
  },
);

// GET /shipments/:id/eta-drift
shipmentsRouter.get(
  '/:id/eta-drift',
  authenticateToken,
  requirePermission('view_intelligence'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await computeEtaDrift(id);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

// GET /shipments/:id
shipmentsRouter.get(
  '/:id',
  authenticateToken,
  requirePermission('view_disruptions'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: { code: 'BAD_ID', message: 'Invalid shipment id' } });
        return;
      }
      const shipment = await Shipment.findById(id)
        .populate('supplier_id', 'code name')
        .populate('warehouse_id', 'code name')
        .lean();
      if (!shipment) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shipment not found' } });
        return;
      }
      res.status(200).json(shipment);
    } catch (e) {
      next(e);
    }
  },
);

