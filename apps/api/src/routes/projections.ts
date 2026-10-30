/**
 * apps/api/src/routes/projections.ts
 *
 * Cover projections endpoint (Step 11, B13).
 * GET /projections/cover
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { computeCover } from '../services/coverDrift.js';

export const projectionsRouter = Router();

projectionsRouter.get(
  '/cover',
  authenticateToken,
  requirePermission('view_intelligence'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await computeCover();
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

