/**
 * apps/api/src/routes/approvals.ts
 *
 * Approvals queue and delegations endpoints (Step 8 Part B, Step 11 Part B, B9).
 * GET    /approvals/queue
 * POST   /approvals/delegations
 * GET    /approvals/delegations
 * DELETE /approvals/delegations/:id
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import { Approval } from '../models/approvals.js';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { ApprovalDelegation } from '../models/approval-delegations.js';
import { User } from '../models/users.js';
import { PlanAction } from '../models/plan-actions.js';
import { createDelegation, revokeDelegation } from '../services/delegations.js';
import { simClock } from '../services/simClock.js';

export const approvalsRouter = Router();

// ---------------------------------------------------------------------------
// GET /approvals/queue — pending items matching caller's role (including active delegations)
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

      const now = await simClock.now();

      // Find all active delegations where user is delegate
      const delegationsReceived = await ApprovalDelegation.find({
        delegate_id: user._id,
        is_active: true,
        valid_from: { $lte: now },
        valid_until: { $gte: now },
      })
        .populate('delegator_id', 'username display_name role')
        .lean();

      // Roles user can approve for (their own, plus any delegated roles)
      const allowedRoles = [user.role, ...delegationsReceived.map((d: any) => d.role || d.delegator_id?.role)];

      // Find all PENDING approvals matching caller's role or delegated roles
      const pendingApprovals = await Approval.find({
        required_role: { $in: allowedRoles },
        status: 'PENDING',
      })
        .populate('plan_id')
        .sort({ plan_version: -1 })
        .lean();

      const items = pendingApprovals
        .filter((a) => a.plan_id)
        .map((a) => {
          const plan = a.plan_id as any;
          const saving = (plan.baseline_value || 0) - (plan.objective_value || plan.total_cost || 0);

          // Find if there's a delegation matching this plan/role
          const matchingDelegation = delegationsReceived.find((d: any) => {
            if (d.role && d.role !== a.required_role) return false;
            if (d.plan_id && !d.plan_id.equals(plan._id)) return false;
            return true;
          });

          let delegationChip = null;
          if (matchingDelegation) {
            delegationChip = {
              delegated_from: (matchingDelegation.delegator_id as any)?.display_name || 'Delegator',
              role: a.required_role,
              valid_until: matchingDelegation.valid_until,
            };
          }

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
            delegation_chip: delegationChip,
          };
        });

      res.status(200).json({ queue: items, total: items.length });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /approvals/delegations — Delegate approval authority (Step 11, B9)
// ---------------------------------------------------------------------------
approvalsRouter.post(
  '/delegations',
  authenticateToken,
  requirePermission('manage_delegations'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const { delegate_id, role, plan_id, valid_from, valid_to, valid_until } = req.body;

      if (!delegate_id) {
        res.status(400).json({ error: { code: 'MISSING_FIELD', message: 'delegate_id is required' } });
        return;
      }

      const delegation = await createDelegation({
        delegator_id: user._id,
        delegate_id,
        role: role || user.role,
        plan_id: plan_id || null,
        valid_from: valid_from || new Date(),
        valid_to: valid_to || valid_until,
      });

      res.status(201).json(delegation);
    } catch (e: any) {
      if (e.statusCode) {
        res.status(e.statusCode).json({ error: { code: e.code || 'BAD_REQUEST', message: e.message } });
        return;
      }
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /approvals/delegations — List active delegations for caller (Step 11, B9)
// ---------------------------------------------------------------------------
approvalsRouter.get(
  '/delegations',
  authenticateToken,
  requirePermission('manage_delegations'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const delegations = await ApprovalDelegation.find({
        $or: [{ delegator_id: user._id }, { delegate_id: user._id }],
        is_active: true,
      })
        .populate('delegator_id', 'username display_name role')
        .populate('delegate_id', 'username display_name role')
        .lean();

      res.status(200).json(delegations);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /approvals/delegations/:id — Revoke active delegation (Step 11, B9)
// ---------------------------------------------------------------------------
approvalsRouter.delete(
  '/delegations/:id',
  authenticateToken,
  requirePermission('manage_delegations'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const delegation = await revokeDelegation(id, req.user!._id);
      res.status(200).json({ ok: true, delegation });
    } catch (e: any) {
      if (e.statusCode) {
        res.status(e.statusCode).json({ error: { code: e.code || 'BAD_REQUEST', message: e.message } });
        return;
      }
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /approvals/plans/:id/review
// Everything the approval panel needs for one plan: summary, actions, and per-role sign-offs.
// ---------------------------------------------------------------------------
approvalsRouter.get(
  '/plans/:id/review',
  authenticateToken,
  requireAnyPermission(['approve_reallocate_split', 'approve_expedite_alt_supplier']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: { code: 'BAD_ID', message: 'Invalid plan id' } });
        return;
      }
      const plan: any = await RecoveryPlan.findById(id).lean();
      if (!plan) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
        return;
      }

      const [actions, signoffs] = await Promise.all([
        PlanAction.find({ plan_id: plan._id }).sort({ seq: 1 }).lean(),
        Approval.find({ plan_id: plan._id, plan_version: plan.version })
          .populate('decided_by', 'display_name role')
          .sort({ required_role: 1 })
          .lean(),
      ]);

      const objective: number = plan.objective_value ?? plan.total_cost ?? 0;
      const baseline: number = plan.baseline_value ?? 0;

      res.status(200).json({
        plan: {
          _id: String(plan._id),
          version: plan.version,
          status: plan.status,
          strategy: plan.strategy,
          objective,
          baseline,
          saving: baseline - objective,
          saving_pct: baseline > 0 ? Math.round(((baseline - objective) / baseline) * 100) : 0,
          scope: plan.scope ?? 'portfolio-level constrained optimisation',
          contract_hash: plan.contract_hash ?? null,
          escalation_required: Boolean(plan.decision_contract?.escalation_approvals_required),
          created_by: plan.created_by ? String(plan.created_by) : null,
          submitted_by: plan.submitted_by ? String(plan.submitted_by) : null,
          created_at: plan.created_at,
          submitted_at: plan.submitted_at,
          approved_at: plan.approved_at,
        },
        actions,
        signoffs,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /approvals/delegate-candidates
// Users who could be given approval authority (Managers and Procurement Approvers, not the caller).
// ---------------------------------------------------------------------------
approvalsRouter.get(
  '/delegate-candidates',
  authenticateToken,
  requirePermission('manage_delegations'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const users = await User.find({
        role: { $in: ['Manager', 'Procurement_Approver'] },
        _id: { $ne: req.user!._id },
      })
        .select('username display_name role')
        .lean();
      res.status(200).json(users);
    } catch (e) {
      next(e);
    }
  },
);
