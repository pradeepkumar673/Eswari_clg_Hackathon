/**
 * apps/api/src/routes/conflicts.ts
 *
 * Allocation Conflict Court endpoints (Step 9, A4).
 *   GET  /conflicts/allocation
 *   GET  /conflicts/allocation/:id
 *   POST /conflicts/allocation/:id/resolve (Manager only)
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { AllocationConflict } from '../models/allocation-conflicts.js';
import { AllocationClaim } from '../models/allocation-claims.js';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { releaseStock } from '../services/reservations.js';
import { writeAudit } from '../services/audit.js';
import { simClock } from '../services/simClock.js';

export const conflictsRouter = Router();

function err(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

// ---------------------------------------------------------------------------
// GET /conflicts/allocation
// ---------------------------------------------------------------------------
conflictsRouter.get(
  '/allocation',
  authenticateToken,
  requirePermission('view_disruptions'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conflicts = await AllocationConflict.find({})
        .populate('sku_id', 'code name')
        .populate('warehouse_id', 'code name')
        .sort({ created_at: -1 })
        .lean();

      const items = await Promise.all(
        conflicts.map(async (c) => {
          const claims = await AllocationClaim.find({ conflict_id: c._id })
            .populate('plan_id', 'version status strategy total_cost')
            .lean();
          return { ...c, claims };
        }),
      );

      res.status(200).json({ conflicts: items, count: items.length });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /conflicts/allocation/:id
// ---------------------------------------------------------------------------
conflictsRouter.get(
  '/allocation/:id',
  authenticateToken,
  requirePermission('view_disruptions'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        err(res, 400, 'BAD_ID', 'Invalid conflict id'); return;
      }

      const conflict = await AllocationConflict.findById(id)
        .populate('sku_id', 'code name')
        .populate('warehouse_id', 'code name')
        .lean();
      if (!conflict) { err(res, 404, 'NOT_FOUND', 'Conflict case not found'); return; }

      const claims = await AllocationClaim.find({ conflict_id: conflict._id })
        .populate('plan_id', 'version status strategy total_cost')
        .lean();

      res.status(200).json({ conflict, claims });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /conflicts/allocation/:id/resolve (Manager only)
// ---------------------------------------------------------------------------
conflictsRouter.post(
  '/allocation/:id/resolve',
  authenticateToken,
  requirePermission('resolve_allocation_conflict'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        err(res, 400, 'BAD_ID', 'Invalid conflict id'); return;
      }

      const conflict = await AllocationConflict.findById(id);
      if (!conflict) { err(res, 404, 'NOT_FOUND', 'Conflict case not found'); return; }

      const { winner_plan_id, reason } = req.body as { winner_plan_id?: string; reason?: string };
      if (!winner_plan_id || !reason) {
        err(res, 400, 'MISSING_FIELDS', 'winner_plan_id and reason are required to resolve allocation conflict');
        return;
      }

      const claims = await AllocationClaim.find({ conflict_id: conflict._id });
      const now = await simClock.now();

      // Find loser plans
      for (const claim of claims) {
        const claimPlanId = claim.plan_id.toString();
        if (claimPlanId === winner_plan_id) {
          claim.granted_qty = claim.requested_qty;
          await claim.save();
        } else {
          claim.granted_qty = 0;
          await claim.save();

          // Loser plan becomes BLOCKED and its reservations are released
          const loserPlan = await RecoveryPlan.findById(claim.plan_id);
          if (loserPlan) {
            loserPlan.status = 'BLOCKED';
            loserPlan.narrative = `${loserPlan.narrative} [BLOCKED by Allocation Conflict Court: ${reason}]`;
            await loserPlan.save();
            await releaseStock(loserPlan._id);
          }
        }
      }

      conflict.status = 'RESOLVED';
      conflict.resolved_at = now;
      await conflict.save();

      await writeAudit({
        action: 'ALLOCATION_CONFLICT_RESOLVED',
        actor: req.user!._id,
        entityType: 'AllocationConflict',
        entityId: conflict._id.toString(),
        after: { winner_plan_id, reason, resolved_at: now },
      });

      res.status(200).json({
        conflict_id: conflict._id,
        status: 'RESOLVED',
        winner_plan_id,
        reason,
        message: 'Allocation conflict resolved. Winner proceeds; loser blocked and reservations released.',
      });
    } catch (e) {
      next(e);
    }
  },
);
