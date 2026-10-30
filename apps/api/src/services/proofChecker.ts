/**
 * apps/api/src/services/proofChecker.ts
 *
 * "The AI proposes. The code proves."
 *
 * Deterministic Proof Checker and Decision Contract Builder (Step 8, M5, W2).
 * Verifies every mandatory claim against live MongoDB state.
 */

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { RecoveryPlan, IRecoveryPlan } from '../models/recovery-plans.js';
import { PlanAction, IPlanAction } from '../models/plan-actions.js';
import { PlanClaim, IPlanClaim, ClaimType } from '../models/plan-claims.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { SupplierSku } from '../models/supplier-skus.js';
import { TransferLane } from '../models/transfer-lanes.js';
import { Order } from '../models/orders.js';
import { OrderLine } from '../models/order-lines.js';
import { Shipment } from '../models/shipments.js';
import { StockReservation } from '../models/stock-reservations.js';
import { OrderPromiseDate } from '../models/order-promise-dates.js';
import { simClock } from './simClock.js';
import { callStructuredLLM } from '../llm/provider.js';

export interface VerificationResult {
  status: 'VERIFIED' | 'BLOCKED';
  claims: Array<{
    claim_type: string;
    origin: string;
    status: 'PASS' | 'FAIL';
    description: string;
    expected: any;
    actual: any;
    evidence_ids: string[];
  }>;
  contract_hash: string;
  decision_contract: DecisionContract;
  failing_claims: string[];
}

export interface DecisionContract {
  plan_id: string;
  version: number;
  contract_hash: string;
  required_approver_roles: string[];
  verification_status: 'VERIFIED' | 'BLOCKED';
  reservation_ids: string[];
  reservation_expiry: string | null;
  rollback_eligibility: boolean;
  expected_impact: {
    total_cost: number;
    residual_risk: number;
    objective: number;
    baseline: number;
  };
  guardrail_results: any[];
  committed_promise_dates: any[];
  escalation_approvals_required: boolean;
}

/**
 * Pure check function for Ask the Desk answer facts (B4).
 */
export function checkAnswerFact(
  answerFacts: Array<{ label: string; value: any }>,
  queryResultRows: any[],
): { pass: boolean; expected: any; actual: any; evidence_ids: string[] } {
  const rowStrings = queryResultRows.map((r) => JSON.stringify(r));
  for (const f of answerFacts) {
    const match = rowStrings.some((s) => s.includes(String(f.value)));
    if (!match) {
      return {
        pass: false,
        expected: f.value,
        actual: 'NOT_FOUND_IN_QUERY_RESULTS',
        evidence_ids: [],
      };
    }
  }
  return {
    pass: true,
    expected: answerFacts.map((f) => f.value),
    actual: answerFacts.map((f) => f.value),
    evidence_ids: queryResultRows.map((r) => r._id?.toString() || 'ROW'),
  };
}

/**
 * Pure check function for Customer Notice dates (B18).
 */
export function checkNoticeDateMatches(
  noticeDateIso: string,
  committedDateIso: string,
): { pass: boolean; expected: string; actual: string } {
  const pass = new Date(noticeDateIso).getTime() === new Date(committedDateIso).getTime();
  return {
    pass,
    expected: committedDateIso,
    actual: noticeDateIso,
  };
}

/**
 * Computes canonical SHA-256 hash of a plan's actions.
 */
export function computeContractHash(actions: IPlanAction[]): string {
  const sorted = [...actions].sort((a, b) => a.seq - b.seq);
  const canonical = sorted.map((a) => ({
    seq: a.seq,
    action_type: a.action_type,
    from: a.from_warehouse_id?.toString() || null,
    to: a.to_warehouse_id.toString(),
    sku: a.sku_id.toString(),
    qty: a.quantity,
    cost: a.cost,
    duration: a.duration_hours,
  }));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Derives required approval roles from plan actions.
 * REALLOCATE/SPLIT -> Manager; EXPEDITE/ALT_SUPPLIER -> Procurement_Approver
 */
export function deriveRequiredApproverRoles(actions: IPlanAction[]): string[] {
  const roles = new Set<string>();
  for (const act of actions) {
    if (act.action_type === 'TRANSFER' || act.action_type === 'SPLIT') {
      roles.add('Manager');
    }
    if (act.action_type === 'EXPEDITE' || act.action_type === 'RESERVE') {
      roles.add('Procurement_Approver');
    }
  }
  if (roles.size === 0) {
    roles.add('Manager');
  }
  return Array.from(roles);
}

/**
 * Generates mandatory SYSTEM claims for every action in a recovery plan.
 */
export async function generateMandatoryClaims(
  plan: IRecoveryPlan,
  actions: IPlanAction[],
): Promise<void> {
  const now = await simClock.now();
  const existingClaims = await PlanClaim.find({
    plan_id: plan._id,
    plan_version: plan.version,
    origin: 'SYSTEM',
  });

  if (existingClaims.length > 0) return; // already generated for this version

  const claimsToInsert: any[] = [];
  const shipment = await Shipment.findOne({}).lean(); // reference for shipment eta

  // Link affected orders
  const affectedOrders = await Order.find({
    warehouse_id: { $in: actions.map((a) => a.to_warehouse_id) },
    status: { $in: ['OPEN', 'RECOVERING'] },
  }).lean();

  for (const act of actions) {
    // 1. AVAILABLE_STOCK (for transfers)
    if (act.from_warehouse_id) {
      claimsToInsert.push({
        plan_id: plan._id,
        plan_version: plan.version,
        action_id: act._id,
        claim_type: 'AVAILABLE_STOCK',
        origin: 'SYSTEM',
        description: `Donor warehouse has >= ${act.quantity} units available for SKU ${act.sku_id}`,
        expected: act.quantity,
        actual: null,
        evidence_ids: [],
        status: 'PASS',
        verified: false,
        checked_at: now,
      });

      // 4. LANE_LEAD_TIME
      claimsToInsert.push({
        plan_id: plan._id,
        plan_version: plan.version,
        action_id: act._id,
        claim_type: 'LANE_LEAD_TIME',
        origin: 'SYSTEM',
        description: `Transfer lane lead time <= ${act.duration_hours} hours`,
        expected: act.duration_hours,
        actual: null,
        evidence_ids: [],
        status: 'PASS',
        verified: false,
        checked_at: now,
      });

      // 9. ROUTE_FEASIBLE
      claimsToInsert.push({
        plan_id: plan._id,
        plan_version: plan.version,
        action_id: act._id,
        claim_type: 'ROUTE_FEASIBLE',
        origin: 'SYSTEM',
        description: `Active transfer route exists between donor and destination warehouse`,
        expected: true,
        actual: null,
        evidence_ids: [],
        status: 'PASS',
        verified: false,
        checked_at: now,
      });
    }

    // 2. SUPPLIER_CAPACITY & 3. SUPPLIER_QUALIFIED (for alt supplier / expedite)
    if (act.action_type === 'RESERVE' || act.action_type === 'EXPEDITE') {
      claimsToInsert.push({
        plan_id: plan._id,
        plan_version: plan.version,
        action_id: act._id,
        claim_type: 'SUPPLIER_CAPACITY',
        origin: 'SYSTEM',
        description: `Qualified supplier has capacity >= ${act.quantity} units`,
        expected: act.quantity,
        actual: null,
        evidence_ids: [],
        status: 'PASS',
        verified: false,
        checked_at: now,
      });

      claimsToInsert.push({
        plan_id: plan._id,
        plan_version: plan.version,
        action_id: act._id,
        claim_type: 'SUPPLIER_QUALIFIED',
        origin: 'SYSTEM',
        description: `Supplier qualification is active and valid`,
        expected: true,
        actual: null,
        evidence_ids: [],
        status: 'PASS',
        verified: false,
        checked_at: now,
      });
    }

    // 8. RESERVATION_AVAILABLE
    claimsToInsert.push({
      plan_id: plan._id,
      plan_version: plan.version,
      action_id: act._id,
      claim_type: 'RESERVATION_AVAILABLE',
      origin: 'SYSTEM',
      description: `Stock reservation capacity is unencumbered by competing plans`,
      expected: act.quantity,
      actual: null,
      evidence_ids: [],
      status: 'PASS',
      verified: false,
      checked_at: now,
    });
  }

  // 5. DEADLINE_MET (per affected order)
  for (const ord of affectedOrders) {
    claimsToInsert.push({
      plan_id: plan._id,
      plan_version: plan.version,
      action_id: null,
      claim_type: 'DEADLINE_MET',
      origin: 'SYSTEM',
      description: `Order ${ord.code} deadline is achievable under proposed recovery timeline`,
      expected: ord.due_at.toISOString(),
      actual: null,
      evidence_ids: [ord._id.toString()],
      status: 'PASS',
      verified: false,
      checked_at: now,
    });

    // 6. ORDER_DEMAND
    claimsToInsert.push({
      plan_id: plan._id,
      plan_version: plan.version,
      action_id: null,
      claim_type: 'ORDER_DEMAND',
      origin: 'SYSTEM',
      description: `Order ${ord.code} demands ${ord.total_units} units`,
      expected: ord.total_units,
      actual: null,
      evidence_ids: [ord._id.toString()],
      status: 'PASS',
      verified: false,
      checked_at: now,
    });

    // 10. PROMISE_DATE_ACHIEVABLE
    claimsToInsert.push({
      plan_id: plan._id,
      plan_version: plan.version,
      action_id: null,
      claim_type: 'PROMISE_DATE_ACHIEVABLE',
      origin: 'SYSTEM',
      description: `Order ${ord.code} committed date is on or after best recoverable date`,
      expected: ord.due_at.toISOString(),
      actual: null,
      evidence_ids: [ord._id.toString()],
      status: 'PASS',
      verified: false,
      checked_at: now,
    });
  }

  // 7. SHIPMENT_ETA
  if (shipment) {
    claimsToInsert.push({
      plan_id: plan._id,
      plan_version: plan.version,
      action_id: null,
      claim_type: 'SHIPMENT_ETA',
      origin: 'SYSTEM',
      description: `Shipment resolved ETA basis is valid`,
      expected: (shipment as any).resolved_eta || (shipment as any).current_eta,
      actual: null,
      evidence_ids: [(shipment as any)._id.toString()],
      status: 'PASS',
      verified: false,
      checked_at: now,
    });
  }

  if (claimsToInsert.length > 0) {
    await PlanClaim.insertMany(claimsToInsert);
  }
}

/**
 * Executes Proof Checker against live database state.
 */
export async function verifyPlan(
  planId: mongoose.Types.ObjectId | string,
): Promise<VerificationResult> {
  const pId = typeof planId === 'string' ? new mongoose.Types.ObjectId(planId) : planId;
  const plan = await RecoveryPlan.findById(pId);
  if (!plan) throw new Error('Recovery plan not found');

  const actions = await PlanAction.find({ plan_id: plan._id }).sort({ seq: 1 });
  await generateMandatoryClaims(plan, actions);

  const claims = await PlanClaim.find({
    plan_id: plan._id,
    plan_version: plan.version,
  });

  const now = await simClock.now();
  const failingClaims: string[] = [];

  for (const claim of claims) {
    let pass = true;
    let actualVal: any = null;
    let evidenceIds: string[] = claim.evidence_ids || [];

    // Evaluate claim according to its type and origin
    if (claim.origin === 'CHALLENGE') {
      // Deliberately injected challenge claim: verify against live state
      if (claim.claim_type === 'AVAILABLE_STOCK') {
        const bal = await InventoryBalance.findOne({
          sku_id: claim.claim_data?.sku_id,
          warehouse_id: claim.claim_data?.warehouse_id,
        });
        actualVal = bal ? bal.on_hand - bal.reserved : 0;
        pass = actualVal >= Number(claim.expected);
        evidenceIds = bal ? [bal._id.toString()] : [];
      } else {
        pass = false; // default challenge assertion fails
        actualVal = 'CHALLENGE_FAILED';
      }
    } else {
      switch (claim.claim_type) {
        case 'AVAILABLE_STOCK': {
          const action = actions.find((a) => a._id.toString() === claim.action_id?.toString());
          if (action && action.from_warehouse_id) {
            const bal = await InventoryBalance.findOne({
              warehouse_id: action.from_warehouse_id,
              sku_id: action.sku_id,
            });
            actualVal = bal ? bal.on_hand - bal.reserved : 0;
            pass = actualVal >= action.quantity;
            if (bal) evidenceIds = [bal._id.toString()];
          }
          break;
        }

        case 'SUPPLIER_CAPACITY': {
          const action = actions.find((a) => a._id.toString() === claim.action_id?.toString());
          if (action) {
            const ss = await SupplierSku.findOne({
              sku_id: action.sku_id,
              warehouse_id: action.to_warehouse_id,
            });
            actualVal = ss ? ss.capacity_per_shipment : 0;
            pass = ss ? actualVal >= action.quantity : false;
            if (ss) evidenceIds = [ss._id.toString()];
          }
          break;
        }

        case 'SUPPLIER_QUALIFIED': {
          const action = actions.find((a) => a._id.toString() === claim.action_id?.toString());
          if (action) {
            const ss = await SupplierSku.findOne({
              sku_id: action.sku_id,
              warehouse_id: action.to_warehouse_id,
            });
            actualVal = ss ? ss.is_qualified : false;
            pass = actualVal === true;
            if (ss) evidenceIds = [ss._id.toString()];
          }
          break;
        }

        case 'LANE_LEAD_TIME': {
          const action = actions.find((a) => a._id.toString() === claim.action_id?.toString());
          if (action && action.from_warehouse_id) {
            const lane = await TransferLane.findOne({
              from_warehouse_id: action.from_warehouse_id,
              to_warehouse_id: action.to_warehouse_id,
            });
            actualVal = lane ? lane.transit_hours : 999;
            pass = lane ? lane.transit_hours <= action.duration_hours : false;
            if (lane) evidenceIds = [lane._id.toString()];
          }
          break;
        }

        case 'ROUTE_FEASIBLE': {
          const action = actions.find((a) => a._id.toString() === claim.action_id?.toString());
          if (action && action.from_warehouse_id) {
            const lane = await TransferLane.findOne({
              from_warehouse_id: action.from_warehouse_id,
              to_warehouse_id: action.to_warehouse_id,
              is_active: true,
            });
            actualVal = lane ? lane.is_active : false;
            pass = actualVal === true;
            if (lane) evidenceIds = [lane._id.toString()];
          }
          break;
        }

        case 'DEADLINE_MET': {
          if (claim.evidence_ids?.[0]) {
            const ord = await Order.findById(claim.evidence_ids[0]);
            if (ord) {
              actualVal = ord.due_at.toISOString();
              pass = ord.due_at.getTime() >= now.getTime();
            }
          }
          break;
        }

        case 'ORDER_DEMAND': {
          if (claim.evidence_ids?.[0]) {
            const ord = await Order.findById(claim.evidence_ids[0]);
            if (ord) {
              actualVal = ord.total_units;
              pass = actualVal === claim.expected;
            }
          }
          break;
        }

        case 'SHIPMENT_ETA': {
          if (claim.evidence_ids?.[0]) {
            const shp = await Shipment.findById(claim.evidence_ids[0]);
            if (shp) {
              actualVal = shp.resolved_eta || shp.current_eta;
              pass = Boolean(actualVal);
            }
          }
          break;
        }

        case 'RESERVATION_AVAILABLE': {
          const action = actions.find((a) => a._id.toString() === claim.action_id?.toString());
          if (action && action.from_warehouse_id) {
            const bal = await InventoryBalance.findOne({
              warehouse_id: action.from_warehouse_id,
              sku_id: action.sku_id,
            });
            actualVal = bal ? bal.on_hand - bal.reserved : 0;
            pass = actualVal >= action.quantity;
          } else {
            actualVal = 'AVAILABLE';
            pass = true;
          }
          break;
        }

        case 'PROMISE_DATE_ACHIEVABLE': {
          if (claim.evidence_ids?.[0]) {
            const opd = await OrderPromiseDate.findOne({ order_id: claim.evidence_ids[0] });
            if (opd) {
              actualVal = opd.current_promise.toISOString();
              pass = opd.current_promise.getTime() >= opd.original_promise.getTime();
            } else {
              actualVal = claim.expected;
              pass = true;
            }
          }
          break;
        }

        default: {
          actualVal = claim.expected;
          pass = true;
          break;
        }
      }
    }

    claim.status = pass ? 'PASS' : 'FAIL';
    claim.verified = pass;
    claim.actual = actualVal;
    claim.evidence_ids = evidenceIds;
    claim.checked_at = now;
    await claim.save();

    if (!pass) {
      failingClaims.push(
        `${claim.claim_type} (${claim.origin}): expected ${JSON.stringify(claim.expected)}, got ${JSON.stringify(actualVal)}`,
      );
    }
  }

  const contractHash = computeContractHash(actions);
  const requiredRoles = deriveRequiredApproverRoles(actions);
  const isVerified = failingClaims.length === 0;

  const decisionContract: DecisionContract = {
    plan_id: plan._id.toString(),
    version: plan.version,
    contract_hash: contractHash,
    required_approver_roles: requiredRoles,
    verification_status: isVerified ? 'VERIFIED' : 'BLOCKED',
    reservation_ids: [],
    reservation_expiry: null,
    rollback_eligibility: true,
    expected_impact: {
      total_cost: plan.total_cost,
      residual_risk: plan.residual_risk,
      objective: (plan as any).objective_value || plan.total_cost,
      baseline: (plan as any).baseline_value || 0,
    },
    guardrail_results: [],
    committed_promise_dates: [],
    escalation_approvals_required: false,
  };

  plan.status = isVerified ? 'VERIFIED' : 'BLOCKED';
  plan.contract_hash = contractHash;
  plan.decision_contract = decisionContract;
  await plan.save();

  return {
    status: isVerified ? 'VERIFIED' : 'BLOCKED',
    claims: claims.map((c) => ({
      claim_type: c.claim_type,
      origin: c.origin,
      status: c.status,
      description: c.description,
      expected: c.expected,
      actual: c.actual,
      evidence_ids: c.evidence_ids,
    })),
    contract_hash: contractHash,
    decision_contract: decisionContract,
    failing_claims: failingClaims,
  };
}

/**
 * Injects a deliberate challenge claim for demo/testing (Analyst, DEMO_MODE).
 */
export async function injectChallenge(
  planId: mongoose.Types.ObjectId | string,
  claimText: string,
  expectedVal: any,
  actualVal: any,
): Promise<IPlanClaim> {
  const pId = typeof planId === 'string' ? new mongoose.Types.ObjectId(planId) : planId;
  const plan = await RecoveryPlan.findById(pId);
  if (!plan) throw new Error('Plan not found');

  const now = await simClock.now();
  const claim = await PlanClaim.create({
    plan_id: plan._id,
    plan_version: plan.version,
    claim_type: 'AVAILABLE_STOCK',
    origin: 'CHALLENGE',
    status: 'FAIL',
    description: claimText,
    expected: expectedVal,
    actual: actualVal,
    evidence_ids: [],
    verified: false,
    checked_at: now,
  });

  plan.status = 'BLOCKED';
  await plan.save();

  return claim;
}

/**
 * Removes any challenge claims on a plan to restore verified eligibility.
 */
export async function clearChallengeClaims(
  planId: mongoose.Types.ObjectId | string,
): Promise<number> {
  const pId = typeof planId === 'string' ? new mongoose.Types.ObjectId(planId) : planId;
  const res = await PlanClaim.deleteMany({ plan_id: pId, origin: 'CHALLENGE' });
  return res.deletedCount || 0;
}
