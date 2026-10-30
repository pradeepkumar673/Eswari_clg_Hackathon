import mongoose, { Schema, Document } from 'mongoose';

export interface IRecoveryPlan extends Document {
  disruption_id: mongoose.Types.ObjectId;
  version: number;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'EXECUTING' | 'COMPLETED' | 'REJECTED';
  strategy: 'REALLOCATE' | 'EXPEDITE' | 'SPLIT' | 'BACKORDER' | 'HYBRID';
  total_cost: number;
  residual_risk: number;
  narrative: string;
  created_by: mongoose.Types.ObjectId;
  created_at: Date;
  approved_at: Date | null;
}

const RecoveryPlanSchema = new Schema<IRecoveryPlan>(
  {
    disruption_id: { type: Schema.Types.ObjectId, ref: 'Disruption', required: true },
    version: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'COMPLETED', 'REJECTED'],
      required: true,
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
  },
  { collection: 'recovery_plans' }
);

RecoveryPlanSchema.index({ disruption_id: 1, version: 1 }, { unique: true });

export const RecoveryPlan = mongoose.model<IRecoveryPlan>('RecoveryPlan', RecoveryPlanSchema);
