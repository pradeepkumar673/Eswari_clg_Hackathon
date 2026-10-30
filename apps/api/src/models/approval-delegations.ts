import mongoose, { Schema, Document } from 'mongoose';

export interface IApprovalDelegation extends Document {
  delegator_id: mongoose.Types.ObjectId;
  delegate_id: mongoose.Types.ObjectId;
  role?: string;
  plan_id?: mongoose.Types.ObjectId | null;
  valid_from: Date;
  valid_until: Date;
  revoked_at?: Date | null;
  is_active: boolean;
}

const approvalDelegationSchema = new Schema<IApprovalDelegation>(
  {
    delegator_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    delegate_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String },
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', default: null },
    valid_from: { type: Date, required: true },
    valid_until: { type: Date, required: true },
    revoked_at: { type: Date, default: null },
    is_active: { type: Boolean, default: true },
  },
  { collection: 'approval_delegations' }
);

approvalDelegationSchema.index({ delegator_id: 1, is_active: 1 });
approvalDelegationSchema.index({ delegate_id: 1, is_active: 1 });

export const ApprovalDelegation = mongoose.model<IApprovalDelegation>('ApprovalDelegation', approvalDelegationSchema);
