import mongoose, { Schema, Document } from 'mongoose';

export interface IPlanTradeoff extends Document {
  plan_id: mongoose.Schema.Types.ObjectId;
  axis: string;
  value: number;
  unit: string;
}

const PlanTradeoffSchema = new Schema<IPlanTradeoff>(
  {
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', required: true },
    axis: { type: String, required: true },
    value: { type: Number, required: true },
    unit: { type: String, required: true },
  },
  { collection: 'plan_tradeoffs' }
);

export const PlanTradeoff = mongoose.model<IPlanTradeoff>('PlanTradeoff', PlanTradeoffSchema);
