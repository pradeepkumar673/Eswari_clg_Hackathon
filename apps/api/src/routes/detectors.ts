/**
 * apps/api/src/routes/detectors.ts
 *
 * Manual trigger for detectors (Step 10, B6, B7).
 * POST /detectors/run (Analyst, Manager)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { runDetectors } from '../services/detectors.js';

export const detectorsRouter = Router();

// ---------------------------------------------------------------------------
// POST /detectors/run
// ---------------------------------------------------------------------------
detectorsRouter.post(
  '/run',
  authenticateToken,
  requirePermission('run_detectors'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const graceMinutes = req.body?.grace_minutes !== undefined ? Number(req.body.grace_minutes) : 60;
      const result = await runDetectors(graceMinutes);

      res.status(200).json({
        ok: true,
        result,
        message: 'Detector sweep completed successfully.',
      });
    } catch (e) {
      next(e);
    }
  },
);

