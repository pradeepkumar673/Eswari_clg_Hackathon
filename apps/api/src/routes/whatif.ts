/**
 * apps/api/src/routes/whatif.ts
 *
 * Step 12 Part A – What-If Simulator routes (B14).
 * POST /whatif/run
 * GET  /whatif/:id
 * GET  /whatif/:id/event-card
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { runWhatIfSimulation } from '../services/whatif.js';
import { SimulationRun } from '../models/simulation-runs.js';

export const whatifRouter = Router();

// POST /whatif/run
whatifRouter.post(
  '/run',
  authenticateToken,
  requirePermission('run_whatif'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const overrides = req.body || {};
      const result = await runWhatIfSimulation(overrides, req.user!._id);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

// GET /whatif/:id
whatifRouter.get(
  '/:id',
  authenticateToken,
  requirePermission('run_whatif'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: { code: 'BAD_ID', message: 'Invalid simulation id' } });
        return;
      }

      const run = await SimulationRun.findById(id).lean();
      if (!run) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Simulation run not found' } });
        return;
      }

      res.status(200).json(run);
    } catch (e) {
      next(e);
    }
  },
);

// GET /whatif/:id/event-card — pre-fill event card draft
whatifRouter.get(
  '/:id/event-card',
  authenticateToken,
  requirePermission('run_whatif'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: { code: 'BAD_ID', message: 'Invalid simulation id' } });
        return;
      }

      const run = await SimulationRun.findById(id).lean();
      if (!run) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Simulation run not found' } });
        return;
      }

      const draft = (run.results as any)?.draft_event_card || {
        source: 'FIELD_REPORT',
        event_type: 'DELAY_REPORTED',
        notes: 'Pre-filled from What-If simulation',
      };

      res.status(200).json({ draft_card: draft, creates_nothing: true });
    } catch (e) {
      next(e);
    }
  },
);

