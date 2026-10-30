/**
 * apps/api/src/routes/spof.ts
 *
 * SPOF Radar endpoints (Step 10, A12).
 * GET /risk/spof
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { computeSPOFRadar } from '../services/spofRadar.js';

export const spofRouter = Router();

// ---------------------------------------------------------------------------
// GET /risk/spof
// ---------------------------------------------------------------------------
spofRouter.get(
  '/spof',
  authenticateToken,
  requirePermission('view_intelligence'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const results = await computeSPOFRadar();
      res.status(200).json({ spof_radar: results, count: results.length });
    } catch (e) {
      next(e);
    }
  },
);

