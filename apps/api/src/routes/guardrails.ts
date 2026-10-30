/**
 * apps/api/src/routes/guardrails.ts
 *
 * Guardrail policies and checks management (Step 9, A9).
 *   GET  /guardrails
 *   PUT  /guardrails/:id (Manager, Administrator)
 *   GET  /plans/:id/guardrails
 *   POST /guardrails/:id/clear-escalation (Manager, Procurement_Approver)
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import { GuardrailPolicy } from '../models/guardrail-policies.js';
import { GuardrailCheck } from '../models/guardrail-checks.js';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { writeAudit } from '../services/audit.js';
import { runGuardrailChecks } from '../services/guardrails.js';

export const guardrailsRouter = Router();

function err(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

// ---------------------------------------------------------------------------
// GET /guardrails
// ---------------------------------------------------------------------------
guardrailsRouter.get(
  '/',
  authenticateToken,
  requirePermission('view_disruptions'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const policies = await GuardrailPolicy.find({}).sort({ code: 1 }).lean();
      res.status(200).json({ policies });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /guardrails/:id (Manager, Administrator)
// ---------------------------------------------------------------------------
guardrailsRouter.put(
  '/:id',
  authenticateToken,
  requirePermission('set_guardrails'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { threshold_value, is_active } = req.body;

      const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { code: id };
      const policy = await GuardrailPolicy.findOne(query);
      if (!policy) { err(res, 404, 'NOT_FOUND', 'Guardrail policy not found'); return; }

      const before = { threshold_value: policy.threshold_value, is_active: policy.is_active };

      if (threshold_value !== undefined) policy.threshold_value = Number(threshold_value);
      if (is_active !== undefined) policy.is_active = Boolean(is_active);

      await policy.save();

      await writeAudit({
        action: 'GUARDRAIL_POLICY_UPDATED',
        actor: req.user!._id,
        entityType: 'GuardrailPolicy',
        entityId: policy._id.toString(),
        before,
        after: { threshold_value: policy.threshold_value, is_active: policy.is_active },
      });

      res.status(200).json({ policy });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /guardrails/:id/clear-escalation (Manager, Procurement_Approver)
// ---------------------------------------------------------------------------
guardrailsRouter.post(
  '/:id/clear-escalation',
  authenticateToken,
  requirePermission('clear_guardrail_escalation'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      // Administrator can NEVER clear an escalation
      if (req.user!.role === 'Administrator') {
        err(res, 403, 'FORBIDDEN', 'Administrator cannot clear guardrail escalations');
        return;
      }

      const check = await GuardrailCheck.findById(id);
      if (!check) { err(res, 404, 'NOT_FOUND', 'Guardrail check not found'); return; }

      check.passed = true;
      check.details = `${check.details} [ESCALATION_CLEARED by ${req.user!.username}]`;
      await check.save();

      const plan = await RecoveryPlan.findById(check.plan_id);
      if (plan) {
        // Re-evaluate checks
        const remainingBreaches = await GuardrailCheck.countDocuments({
          plan_id: plan._id,
          plan_version: plan.version,
          passed: false,
        });

        if (remainingBreaches === 0) {
          (plan as any).guardrail_status = 'NORMAL';
          if (plan.decision_contract) {
            plan.decision_contract.escalation_approvals_required = false;
          }
          await plan.save();
        }
      }

      await writeAudit({
        action: 'GUARDRAIL_ESCALATION_CLEARED',
        actor: req.user!._id,
        entityType: 'GuardrailCheck',
        entityId: check._id.toString(),
        after: { cleared_by: req.user!.username, role: req.user!.role },
      });

      res.status(200).json({
        check_id: check._id,
        status: 'CLEARED',
        message: 'Guardrail escalation cleared successfully.',
      });
    } catch (e) {
      next(e);
    }
  },
);

