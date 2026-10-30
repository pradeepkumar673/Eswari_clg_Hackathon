import mongoose, { Schema, Document } from 'mongoose';

export type ClaimType =
  | 'STOCK_AVAILABLE'
  | 'STOCK_NOT_DOUBLE_COUNTED'
  | 'COST_ARITHMETIC'
  | 'LEAD_TIME_FEASIBLE'
  | 'SUPPLIER_QUALIFIED'
  | 'ROUTE_EXISTS'
  | 'PRIORITY_RESPECTED'
  | 'GUARDRAIL_PASSED'
  | 'RISK_REDUCED'
  | 'NO_CIRCULAR_TRANSFER'
  | 'QUANTITY_MATCH'
  | 'SEPARATION_OF_DUTIES';

export interface IPlanClaim extends Document {
  plan_id: mongoose.Types.ObjectId;
  claim_type: ClaimType;
  claim_data: any;
  verified: boolean;
  verification_details: any;
  checked_at: Date;
}

const PlanClaimSchema = new Schema<IPlanClaim>(
  {
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', required: true },
    claim_type: {
      type: String,
      enum: [
        'STOCK_AVAILABLE',
        'STOCK_NOT_DOUBLE_COUNTED',
        'COST_ARITHMETIC',
        'LEAD_TIME_FEASIBLE',
        'SUPPLIER_QUALIFIED',
        'ROUTE_EXISTS',
        'PRIORITY_RESPECTED',
        'GUARDRAIL_PASSED',
        'RISK_REDUCED',
        'NO_CIRCULAR_TRANSFER',
        'QUANTITY_MATCH',
        'SEPARATION_OF_DUTIES',
      ],
      required: true,
    },
    claim_data: { type: Schema.Types.Mixed, required: true },
    verified: { type: Boolean, required: true },
    verification_details: { type: Schema.Types.Mixed, required: true },
    checked_at: { type: Date, required: true, default: Date.now },
  },
  { collection: 'plan_claims' }
);

export const PlanClaim = mongoose.model<IPlanClaim>('PlanClaim', PlanClaimSchema);
