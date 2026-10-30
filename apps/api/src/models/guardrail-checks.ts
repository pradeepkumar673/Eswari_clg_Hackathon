import mongoose, { Schema, Document } from 'mongoose';

export interface IGuardrailCheck extends Document {
  plan_id: mongoose.Types.ObjectId;
  plan_version: number;
  policy_id: mongoose.Types.ObjectId;
  actual_value: number;
  limit_value?: number;
  passed: boolean;
  details?: string;
  escalation_approval_id?: mongoose.Types.ObjectId | null;
  checked_at: Date;
}

const guardrailCheckSchema = new Schema<IGuardrailCheck>(
  {
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', required: true },
    plan_version: { type: Number, required: true },
    policy_id: { type: Schema.Types.ObjectId, ref: 'GuardrailPolicy', required: true },
    actual_value: { type: Number, required: true },
    limit_value: { type: Number },
    passed: { type: Boolean, required: true },
    details: { type: String, default: '' },
    escalation_approval_id: { type: Schema.Types.ObjectId, ref: 'Approval', default: null },
    checked_at: { type: Date, default: Date.now },
  },
  { collection: 'guardrail_checks' }
);

guardrailCheckSchema.index({ plan_id: 1, plan_version: 1, policy_id: 1 });

export const GuardrailCheck = mongoose.model<IGuardrailCheck>('GuardrailCheck', guardrailCheckSchema);
