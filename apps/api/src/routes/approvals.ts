/**
 * apps/api/src/routes/approvals.ts
 *
 * Approvals queue endpoint (Step 8 Part B, M6).
 * GET /approvals/queue
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requireAnyPermission } from '../middleware/auth.js';
import { Approval } from '../models/approvals.js';
import { RecoveryPlan } from '../models/recovery-plans.js';

export const approvalsRouter = Router();

// ---------------------------------------------------------------------------
// GET /approvals/queue — pending items matching caller's role
// ---------------------------------------------------------------------------
approvalsRouter.get(
  '/queue',
  authenticateToken,
  requireAnyPermission(['approve_reallocate_split', 'approve_expedite_alt_supplier']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      if (!['Manager', 'Procurement_Approver'].includes(user.role)) {
        res.status(200).json({ queue: [], total: 0 });
        return;
      }

      // Find all PENDING approvals matching caller's role
      const pendingApprovals = await Approval.find({
        required_role: user.role,
        status: 'PENDING',
      })
        .populate('plan_id')
        .sort({ plan_version: -1 })
        .lean();

      const items = pendingApprovals
        .filter((a) => a.plan_id) // ensure linked plan exists
        .map((a) => {
          const plan = a.plan_id as any;
          const saving = (plan.baseline_value || 0) - (plan.objective_value || plan.total_cost || 0);

          return {
            approval_id: a._id,
            plan_id: plan._id,
            disruption_id: plan.disruption_id,
            plan_version: a.plan_version,
            required_role: a.required_role,
            contract_hash: a.contract_hash,
            status: a.status,
            strategy: plan.strategy,
            total_cost: plan.total_cost,
            objective: plan.objective_value || plan.total_cost,
            baseline: plan.baseline_value || 0,
            saving,
            created_by: plan.created_by,
            escalation_flag: Boolean(plan.decision_contract?.escalation_approvals_required),
            delegation_chip: null, // real field, null until Step 11
          };
        });

      res.status(200).json({ queue: items, total: items.length });
    } catch (e) {
      next(e);
    }
  },
);
