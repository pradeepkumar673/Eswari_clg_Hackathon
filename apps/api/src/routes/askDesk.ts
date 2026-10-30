/**
 * apps/api/src/routes/askDesk.ts
 *
 * Step 12 Part A – Ask the Desk endpoint (B4).
 * POST /ask
 * GET  /ask/chips
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { processAskQuery, SUGGESTED_CHIPS } from '../services/askDesk.js';

export const askDeskRouter = Router();

// POST /ask
askDeskRouter.post(
  '/',
  authenticateToken,
  requirePermission('ask_the_desk'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.body.query || req.body.question || '';
      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: { code: 'QUERY_REQUIRED', message: 'Query string is required' } });
        return;
      }

      const result = await processAskQuery(query, req.user!);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

// GET /ask/chips
askDeskRouter.get(
  '/chips',
  authenticateToken,
  requirePermission('ask_the_desk'),
  async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json({ chips: SUGGESTED_CHIPS });
  },
);

