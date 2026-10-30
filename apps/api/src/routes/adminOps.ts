/**
 * apps/api/src/routes/adminOps.ts
 *
 * Step 12 Part B – Admin Stress-Test & Red-Team endpoints (A11, S3).
 * POST /admin/stress/run
 * POST /admin/stress/cleanup
 * POST /admin/red-team/run
 * GET  /admin/red-team/report
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { runStressTest } from '../services/stressTest.js';
import { runRedTeamSuite } from '../services/redTeam.js';
import { StressRun } from '../models/stress-runs.js';

export const adminOpsRouter = Router();

// ---------------------------------------------------------------------------
// POST /admin/stress/run (Admin, DEMO_MODE) — Step 12, A11
// ---------------------------------------------------------------------------
adminOpsRouter.post(
  '/stress/run',
  authenticateToken,
  requirePermission('run_stress_test'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const options = req.body || {};
      const result = await runStressTest(options, req.user!._id);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/stress/cleanup — Clean up stress test synthetic artifacts
// ---------------------------------------------------------------------------
adminOpsRouter.post(
  '/stress/cleanup',
  authenticateToken,
  requirePermission('run_stress_test'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await StressRun.deleteMany({});
      res.status(200).json({ ok: true, message: 'Stress test artifacts cleaned up successfully' });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/red-team/run (Admin) — Step 12, S3
// ---------------------------------------------------------------------------
adminOpsRouter.post(
  '/red-team/run',
  authenticateToken,
  requirePermission('manage_users_redteam'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const report = await runRedTeamSuite(req.user!._id);
      res.status(200).json(report);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/red-team/report (Admin)
// ---------------------------------------------------------------------------
adminOpsRouter.get(
  '/red-team/report',
  authenticateToken,
  requirePermission('manage_users_redteam'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const report = await runRedTeamSuite(req.user!._id);
      res.status(200).json(report);
    } catch (e) {
      next(e);
    }
  },
);

