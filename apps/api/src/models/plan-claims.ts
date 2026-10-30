import mongoose, { Schema, Document } from 'mongoose';

export type ClaimType =
  | 'AVAILABLE_STOCK'
  | 'SUPPLIER_CAPACITY'
  | 'SUPPLIER_QUALIFIED'
  | 'LANE_LEAD_TIME'
  | 'DEADLINE_MET'
  | 'ORDER_DEMAND'
  | 'SHIPMENT_ETA'
  | 'RESERVATION_AVAILABLE'
  | 'ROUTE_FEASIBLE'
  | 'PROMISE_DATE_ACHIEVABLE'
  | 'ANSWER_FACT'
  | 'NOTICE_DATE_MATCHES'
  | 'STOCK_AVAILABLE'
  | 'STOCK_NOT_DOUBLE_COUNTED'
  | 'COST_ARITHMETIC'
  | 'LEAD_TIME_FEASIBLE'
  | 'ROUTE_EXISTS'
  | 'PRIORITY_RESPECTED'
  | 'GUARDRAIL_PASSED'
  | 'RISK_REDUCED'
  | 'NO_CIRCULAR_TRANSFER'
  | 'QUANTITY_MATCH'
  | 'SEPARATION_OF_DUTIES';

export type ClaimOrigin = 'SYSTEM' | 'LLM' | 'CHALLENGE';
export type ClaimStatus = 'PASS' | 'FAIL';

export interface IPlanClaim extends Document {
  plan_id: mongoose.Types.ObjectId;
  plan_version: number;
  action_id: mongoose.Types.ObjectId | null;
  claim_type: ClaimType;
  origin: ClaimOrigin;
  status: ClaimStatus;
  description: string;
  expected: any;
  actual: any;
  evidence_ids: string[];
  claim_data?: any;
  verified: boolean;
  verification_details?: any;
  checked_at: Date;
}

const PlanClaimSchema = new Schema<IPlanClaim>(
  {
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', required: true },
    plan_version: { type: Number, required: true, default: 1 },
    action_id: { type: Schema.Types.ObjectId, ref: 'PlanAction', default: null },
    claim_type: {
      type: String,
      required: true,
    },
    origin: {
      type: String,
      enum: ['SYSTEM', 'LLM', 'CHALLENGE'],
      default: 'SYSTEM',
    },
    status: {
      type: String,
      enum: ['PASS', 'FAIL'],
      default: 'PASS',
    },
    description: { type: String, default: '' },
    expected: { type: Schema.Types.Mixed },
    actual: { type: Schema.Types.Mixed },
    evidence_ids: [{ type: String }],
    claim_data: { type: Schema.Types.Mixed, default: {} },
    verified: { type: Boolean, default: true },
    verification_details: { type: Schema.Types.Mixed, default: {} },
    checked_at: { type: Date, required: true, default: Date.now },
  },
  { collection: 'plan_claims' }
);

PlanClaimSchema.index({ plan_id: 1, plan_version: 1 });

export const PlanClaim = mongoose.model<IPlanClaim>('PlanClaim', PlanClaimSchema);
