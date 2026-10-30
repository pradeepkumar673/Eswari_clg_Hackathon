/**
 * apps/api/src/services/guardrails.ts
 *
 * Budget and Operational Guardrails Engine (Step 9, A9).
 * Checks 4 policies on every plan version:
 *   1. EXPEDITE_SPEND (max ₹6,000)
 *   2. SERVICE_DAMAGE_RESIDUAL (max ₹2,500)
 *   3. SUPPLIER_RISK (max score 50)
 *   4. TRANSFER_DISTANCE (max 400 km)
 */

import mongoose from 'mongoose';
import { GuardrailPolicy } from '../models/guardrail-policies.js';
import { GuardrailCheck, IGuardrailCheck } from '../models/guardrail-checks.js';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { PlanAction } from '../models/plan-actions.js';
import { TransferLane } from '../models/transfer-lanes.js';
import { Supplier } from '../models/suppliers.js';
import { SupplierSku } from '../models/supplier-skus.js';
import { writeAudit } from './audit.js';
import { simClock } from './simClock.js';
import { publish } from './bus.js';

export interface GuardrailRunResult {
  allPassed: boolean;
  escalated: boolean;
  addedRoles: string[];
  checks: Array<{
    code: string;
    description: string;
    actual_value: number;
    threshold_value: number;
    passed: boolean;
    details: string;
  }>;
}

export async function runGuardrailChecks(
  planId: mongoose.Types.ObjectId | string,
  version?: number,
): Promise<GuardrailRunResult> {
  const pId = typeof planId === 'string' ? new mongoose.Types.ObjectId(planId) : planId;
  const plan = await RecoveryPlan.findById(pId);
  if (!plan) throw new Error('Recovery plan not found');

  const planVersion = version !== undefined ? version : plan.version;
  const actions = await PlanAction.find({ plan_id: pId });
  const policies = await GuardrailPolicy.find({ is_active: true });
  const now = await simClock.now();

  const results: GuardrailRunResult['checks'] = [];
  let anyBreached = false;

  for (const pol of policies) {
    let actualValue = 0;
    let details = '';

    switch (pol.code) {
      case 'EXPEDITE_SPEND': {
        // Spend on expedite and alt suppliers
        const expediteActions = actions.filter(
          (a) => a.action_type === 'EXPEDITE' || a.action_type === 'RESERVE',
        );
        actualValue = expediteActions.reduce((s, a) => s + a.cost, 0);
        details = `Expedite + alternate supplier spend: ₹${actualValue}`;
        break;
      }

      case 'SERVICE_DAMAGE_RESIDUAL': {
        // Residual penalty cost
        const actionCost = actions.reduce((s, a) => s + a.cost, 0);
        actualValue = Math.max(0, plan.total_cost - actionCost);
        details = `Residual service penalty: ₹${actualValue}`;
        break;
      }

      case 'SUPPLIER_RISK': {
        // Supplier risk score of alt suppliers used
        let maxRisk = 0;
        const reserveActions = actions.filter((a) => a.action_type === 'RESERVE');
        for (const act of reserveActions) {
          const ss = await SupplierSku.findOne({ sku_id: act.sku_id, warehouse_id: act.to_warehouse_id });
          if (ss) {
            const sup = await Supplier.findById(ss.supplier_id);
            if (sup && (sup as any).risk_score) {
              maxRisk = Math.max(maxRisk, (sup as any).risk_score);
            }
          }
        }
        actualValue = maxRisk;
        details = `Max supplier risk score: ${actualValue}`;
        break;
      }

      case 'TRANSFER_DISTANCE': {
        // Max transfer lane distance
        let maxDist = 0;
        const transferActions = actions.filter((a) => a.action_type === 'TRANSFER' && a.from_warehouse_id);
        for (const act of transferActions) {
          const lane = await TransferLane.findOne({
            from_warehouse_id: act.from_warehouse_id,
            to_warehouse_id: act.to_warehouse_id,
          });
          if (lane && lane.distance_km) {
            maxDist = Math.max(maxDist, lane.distance_km);
          }
        }
        actualValue = maxDist;
        details = `Max transfer lane distance: ${actualValue} km`;
        break;
      }

      default: {
        actualValue = 0;
        details = 'Standard policy check';
        break;
      }
    }

    const passed = actualValue <= pol.threshold_value;
    if (!passed) anyBreached = true;

    // Record or update guardrail_checks row
    await GuardrailCheck.findOneAndUpdate(
      { plan_id: plan._id, plan_version: planVersion, policy_id: pol._id },
      {
        $set: {
          actual_value: actualValue,
          limit_value: pol.threshold_value,
          passed,
          details,
          checked_at: now,
        },
      },
      { upsert: true, new: true },
    );

    results.push({
      code: pol.code,
      description: pol.description,
      actual_value: actualValue,
      threshold_value: pol.threshold_value,
      passed,
      details,
    });
  }

  const addedRoles: string[] = [];
  let isEscalated = false;

  if (anyBreached) {
    // If only one role currently required, add the missing role
    const currentRoles = plan.decision_contract?.required_approver_roles || ['Manager'];
    if (!currentRoles.includes('Manager')) {
      addedRoles.push('Manager');
      currentRoles.push('Manager');
    }
    if (!currentRoles.includes('Procurement_Approver')) {
      addedRoles.push('Procurement_Approver');
      currentRoles.push('Procurement_Approver');
    }

    // If both roles were already required, escalate
    if (addedRoles.length === 0) {
      isEscalated = true;
      if (plan.decision_contract) {
        plan.decision_contract.escalation_approvals_required = true;
      }
      (plan as any).guardrail_status = 'ESCALATED';
      await plan.save();

      await writeAudit({
        action: 'GUARDRAIL_ESCALATION',
        actor: plan.created_by,
        entityType: 'RecoveryPlan',
        entityId: plan._id.toString(),
        after: { version: planVersion, breached_checks: results.filter((r) => !r.passed) },
      });
    } else {
      if (plan.decision_contract) {
        plan.decision_contract.required_approver_roles = currentRoles;
      }
      await plan.save();
    }
  }

  return {
    allPassed: !anyBreached,
    escalated: isEscalated,
    addedRoles,
    checks: results,
  };
}

