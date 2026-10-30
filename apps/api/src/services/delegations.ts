/**
 * apps/api/src/services/delegations.ts
 *
 * Step 11 Part B – Approval Delegation Service (B9).
 *
 * Rules:
 * - Delegate must hold the same role as delegator
 * - Delegate cannot be the Administrator
 * - Delegate cannot be the plan's creator or any modifier
 * - Delegations are time-boxed (valid_from to valid_to / valid_until)
 * - Delegator LOSES approval rights on that plan while delegation is active
 * - Approvals made by delegate store acted_as_delegate_of (delegated_from)
 * - Decision contract records delegations in force
 */

import mongoose from 'mongoose';
import { ApprovalDelegation, IApprovalDelegation } from '../models/approval-delegations.js';
import { User, IUser } from '../models/users.js';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { simClock } from './simClock.js';
import { writeAudit } from './audit.js';
import { publish } from './bus.js';

export interface CreateDelegationInput {
  delegator_id: mongoose.Types.ObjectId;
  delegate_id: string | mongoose.Types.ObjectId;
  role?: string;
  plan_id?: string | mongoose.Types.ObjectId | null;
  valid_from: Date | string;
  valid_to?: Date | string;
  valid_until?: Date | string;
}

export async function createDelegation(input: CreateDelegationInput): Promise<IApprovalDelegation> {
  const delegator = await User.findById(input.delegator_id);
  if (!delegator) {
    const err: any = new Error('Delegator user not found');
    err.statusCode = 404;
    throw err;
  }

  const delegate = await User.findById(input.delegate_id);
  if (!delegate) {
    const err: any = new Error('Delegate user not found');
    err.statusCode = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  // 1. Delegate can NEVER be the Administrator
  if (delegate.role === 'Administrator') {
    const err: any = new Error('Cannot delegate approval authority to Administrator');
    err.statusCode = 403;
    err.code = 'INVALID_DELEGATE_ADMIN';
    throw err;
  }

  // 2. Delegate must hold the SAME role
  const targetRole = input.role || delegator.role;
  if (delegate.role !== delegator.role) {
    const err: any = new Error(
      `Delegate must hold the same role as delegator (${delegator.role}), but delegate has role ${delegate.role}`,
    );
    err.statusCode = 403;
    err.code = 'ROLE_MISMATCH';
    throw err;
  }

  // 3. Delegate must not be the plan's creator or any modifier
  let planIdObj: mongoose.Types.ObjectId | null = null;
  if (input.plan_id) {
    planIdObj = new mongoose.Types.ObjectId(input.plan_id);
    const plan = await RecoveryPlan.findById(planIdObj);
    if (!plan) {
      const err: any = new Error('Plan not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (plan.created_by.equals(delegate._id)) {
      const err: any = new Error('Cannot delegate approval to the creator of the plan');
      err.statusCode = 403;
      err.code = 'DELEGATE_IS_CREATOR';
      throw err;
    }

    if (plan.submitted_by && plan.submitted_by.equals(delegate._id)) {
      const err: any = new Error('Cannot delegate approval to the submitter of the plan');
      err.statusCode = 403;
      err.code = 'DELEGATE_IS_SUBMITTER';
      throw err;
    }

    if (plan.modifier_ids && plan.modifier_ids.some((m) => m.equals(delegate._id))) {
      const err: any = new Error('Cannot delegate approval to a modifier of the plan');
      err.statusCode = 403;
      err.code = 'DELEGATE_IS_MODIFIER';
      throw err;
    }
  }

  const validFrom = new Date(input.valid_from);
  const validUntil = new Date(input.valid_to || input.valid_until || Date.now() + 86400000);

  const delegation = await ApprovalDelegation.create({
    delegator_id: delegator._id,
    delegate_id: delegate._id,
    role: targetRole,
    plan_id: planIdObj,
    valid_from: validFrom,
    valid_until: validUntil,
    is_active: true,
  });

  // Audit
  await writeAudit({
    actor: delegator._id,
    action: 'DELEGATION_CREATED',
    entityType: 'ApprovalDelegation',
    entityId: delegation._id.toString(),
    after: {
      delegator_id: delegator._id,
      delegate_id: delegate._id,
      role: targetRole,
      plan_id: planIdObj,
      valid_from: validFrom,
      valid_until: validUntil,
    },
  });

  // Notification for DELEGATION_RECEIVED
  await publish('DELEGATION_RECEIVED', {
    delegationId: delegation._id.toString(),
    delegatorId: delegator._id.toString(),
    delegateId: delegate._id.toString(),
    role: targetRole,
    planId: planIdObj ? planIdObj.toString() : null,
  });

  return delegation;
}

export async function revokeDelegation(
  delegationId: string,
  actorId: mongoose.Types.ObjectId,
): Promise<IApprovalDelegation> {
  const delegation = await ApprovalDelegation.findById(delegationId);
  if (!delegation) {
    const err: any = new Error('Delegation not found');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const now = await simClock.now();
  delegation.is_active = false;
  delegation.revoked_at = now;
  await delegation.save();

  await writeAudit({
    actor: actorId,
    action: 'DELEGATION_REVOKED',
    entityType: 'ApprovalDelegation',
    entityId: delegation._id.toString(),
    after: { is_active: false, revoked_at: now },
  });

  return delegation;
}

export async function findActiveDelegationForUser(
  userId: mongoose.Types.ObjectId,
  role: string,
  planId?: mongoose.Types.ObjectId | null,
): Promise<IApprovalDelegation | null> {
  const now = await simClock.now();

  const query: any = {
    delegate_id: userId,
    is_active: true,
    valid_from: { $lte: now },
    valid_until: { $gte: now },
  };

  if (planId) {
    query.$or = [{ plan_id: planId }, { plan_id: null }];
  }

  return ApprovalDelegation.findOne(query);
}

export async function hasDelegatorRelinquishedRights(
  delegatorId: mongoose.Types.ObjectId,
  planId?: mongoose.Types.ObjectId | null,
): Promise<boolean> {
  const now = await simClock.now();

  const query: any = {
    delegator_id: delegatorId,
    is_active: true,
    valid_from: { $lte: now },
    valid_until: { $gte: now },
  };

  if (planId) {
    query.$or = [{ plan_id: planId }, { plan_id: null }];
  }

  const count = await ApprovalDelegation.countDocuments(query);
  return count > 0;
}

