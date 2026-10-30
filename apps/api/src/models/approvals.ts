import mongoose, { Schema, Document } from 'mongoose';

export interface IApproval extends Document {
  plan_id: mongoose.Types.ObjectId;
  plan_version: number;
  required_role: string;
  contract_hash: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decided_by: mongoose.Types.ObjectId | null;
  decided_at: Date | null;
  comment: string | null;
  delegated_from: mongoose.Types.ObjectId | null;
}

const ApprovalSchema = new Schema<IApproval>(
  {
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', required: true },
    plan_version: { type: Number, required: true },
    required_role: { type: String, required: true },
    contract_hash: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      required: true,
      default: 'PENDING',
    },
    decided_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decided_at: { type: Date, default: null },
    comment: { type: String, default: null },
    delegated_from: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'approvals' }
);

ApprovalSchema.index(
  { plan_id: 1, plan_version: 1, required_role: 1 },
  { unique: true }
);

export const Approval = mongoose.model<IApproval>('Approval', ApprovalSchema);
