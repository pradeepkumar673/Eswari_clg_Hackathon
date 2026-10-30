/**
 * apps/api/src/routes/lineage.ts
 *
 * Event Lineage endpoint (Step 10, A8).
 * GET /orders/:id/lineage?disruption=
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { buildOrderLineage } from '../services/lineage.js';

export const lineageRouter = Router();

// ---------------------------------------------------------------------------
// GET /orders/:id/lineage
// ---------------------------------------------------------------------------
lineageRouter.get(
  '/:id/lineage',
  authenticateToken,
  requirePermission('view_intelligence'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const disruptionId = req.query.disruption as string | undefined;

      const lineage = await buildOrderLineage(id, disruptionId);
      res.status(200).json(lineage);
    } catch (e: any) {
      if (e.message && e.message.includes('not found')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: e.message } });
        return;
      }
      next(e);
    }
  },
);

