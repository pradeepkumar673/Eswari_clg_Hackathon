import mongoose, { Schema, Document } from 'mongoose';

export type PlanStatus =
  | 'DRAFT'
  | 'VERIFIED'
  | 'BLOCKED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'ROLLED_BACK';

export interface IRecoveryPlan extends Document {
  disruption_id: mongoose.Types.ObjectId;
  version: number;
  status: PlanStatus;
  strategy: 'REALLOCATE' | 'EXPEDITE' | 'SPLIT' | 'BACKORDER' | 'HYBRID';
  total_cost: number;
  residual_risk: number;
  narrative: string;
  created_by: mongoose.Types.ObjectId;
  created_at: Date;
  approved_at: Date | null;
  contract_hash?: string | null;
  decision_contract?: any | null;
  submitted_by?: mongoose.Types.ObjectId | null;
  submitted_at?: Date | null;
  modifier_ids?: mongoose.Types.ObjectId[];
  objective_value?: number;
  baseline_value?: number;
  scope?: string;
  per_order?: any[];
  collateral?: string[];
}

const RecoveryPlanSchema = new Schema<IRecoveryPlan>(
  {
    disruption_id: { type: Schema.Types.ObjectId, ref: 'Disruption', required: true },
    version: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: [
        'DRAFT',
        'VERIFIED',
        'BLOCKED',
        'PENDING_APPROVAL',
        'APPROVED',
        'EXECUTING',
        'EXECUTED',
        'COMPLETED',
        'REJECTED',
        'ROLLED_BACK',
      ],
      required: true,
      default: 'DRAFT',
    },
    strategy: {
      type: String,
      enum: ['REALLOCATE', 'EXPEDITE', 'SPLIT', 'BACKORDER', 'HYBRID'],
      required: true,
    },
    total_cost: { type: Number, required: true },
    residual_risk: { type: Number, required: true, min: 0, max: 100 },
    narrative: { type: String, required: true },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    created_at: { type: Date, required: true, default: Date.now },
    approved_at: { type: Date, default: null },
    contract_hash: { type: String, default: null },
    decision_contract: { type: Schema.Types.Mixed, default: null },
    submitted_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    submitted_at: { type: Date, default: null },
    modifier_ids: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    objective_value: { type: Number },
    baseline_value: { type: Number },
    scope: { type: String },
    per_order: [{ type: Schema.Types.Mixed }],
    collateral: [{ type: String }],
  },
  { collection: 'recovery_plans' }
);

RecoveryPlanSchema.index({ disruption_id: 1, version: 1 }, { unique: true });

export const RecoveryPlan = mongoose.model<IRecoveryPlan>('RecoveryPlan', RecoveryPlanSchema);
