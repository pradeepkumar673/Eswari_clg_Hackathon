import mongoose, { Schema, Document } from 'mongoose';

export interface IPlanAction extends Document {
  plan_id: mongoose.Types.ObjectId;
  seq: number;
  action_type: 'RESERVE' | 'TRANSFER' | 'EXPEDITE' | 'BACKORDER' | 'SPLIT';
  from_warehouse_id: mongoose.Types.ObjectId | null;
  to_warehouse_id: mongoose.Types.ObjectId;
  sku_id: mongoose.Types.ObjectId;
  quantity: number;
  cost: number;
  duration_hours: number;
  status: 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
}

const PlanActionSchema = new Schema<IPlanAction>(
  {
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', required: true },
    seq: { type: Number, required: true },
    action_type: {
      type: String,
      enum: ['RESERVE', 'TRANSFER', 'EXPEDITE', 'BACKORDER', 'SPLIT'],
      required: true,
    },
    from_warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    to_warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    sku_id: { type: Schema.Types.ObjectId, ref: 'Sku', required: true },
    quantity: { type: Number, required: true },
    cost: { type: Number, required: true },
    duration_hours: { type: Number, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'EXECUTING', 'COMPLETED', 'FAILED', 'ROLLED_BACK'],
      required: true,
    },
  },
  { collection: 'plan_actions' }
);

export const PlanAction = mongoose.model<IPlanAction>('PlanAction', PlanActionSchema);
