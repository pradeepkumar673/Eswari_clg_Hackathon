/**
 * apps/api/src/routes/fingerprints.ts
 *
 * Disruption fingerprints endpoint (Step 11, A10).
 * GET /fingerprints
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { listFingerprints } from '../services/fingerprints.js';

export const fingerprintsRouter = Router();

fingerprintsRouter.get(
  '/',
  authenticateToken,
  requirePermission('view_intelligence'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await listFingerprints();
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

