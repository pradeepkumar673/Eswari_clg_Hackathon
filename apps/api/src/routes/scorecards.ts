/**
 * apps/api/src/routes/scorecards.ts
 *
 * Supplier scorecards endpoint (Step 11, B8).
 * GET /suppliers/scorecards
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { getRankedScorecards, recomputeAllScorecards } from '../services/scorecards.js';

export const scorecardsRouter = Router();

// GET /suppliers/scorecards (or GET /scorecards)
scorecardsRouter.get(
  '/scorecards',
  authenticateToken,
  requirePermission('view_scorecards'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await getRankedScorecards();
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

// Optional trigger to recompute
scorecardsRouter.post(
  '/scorecards/recompute',
  authenticateToken,
  requirePermission('view_scorecards'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await recomputeAllScorecards();
      const result = await getRankedScorecards();
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

