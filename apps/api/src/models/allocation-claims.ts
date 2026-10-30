import mongoose, { Schema, Document } from 'mongoose';

export interface IAllocationClaim extends Document {
  conflict_id: mongoose.Schema.Types.ObjectId;
  plan_id: mongoose.Schema.Types.ObjectId;
  order_id: mongoose.Schema.Types.ObjectId;
  requested_qty: number;
  granted_qty: number;
  priority_score: number;
  reason: string;
}

const AllocationClaimSchema = new Schema<IAllocationClaim>(
  {
    conflict_id: { type: Schema.Types.ObjectId, ref: 'AllocationConflict', required: true },
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', required: true },
    order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    requested_qty: { type: Number, required: true },
    granted_qty: { type: Number, required: true },
    priority_score: { type: Number, required: true },
    reason: { type: String, required: true },
  },
  { collection: 'allocation_claims' }
);

export const AllocationClaim = mongoose.model<IAllocationClaim>('AllocationClaim', AllocationClaimSchema);
