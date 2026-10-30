import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderRiskSnapshot extends Document {
  order_id: mongoose.Types.ObjectId;
  risk_score: number;
  urgency: number;
  supply_gap: number;
  delay_factor: number;
  penalty_factor: number;
  band: string;
  snapshot_at: Date;
}

const OrderRiskSnapshotSchema = new Schema<IOrderRiskSnapshot>(
  {
    order_id: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    risk_score: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    urgency: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    supply_gap: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    delay_factor: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    penalty_factor: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    band: {
      type: String,
      required: true,
      enum: ['RED', 'AMBER', 'GREEN'],
    },
    snapshot_at: {
      type: Date,
      required: true,
    },
  },
  { collection: 'order_risk_snapshots' }
);

export const OrderRiskSnapshot = mongoose.model<IOrderRiskSnapshot>(
  'OrderRiskSnapshot',
  OrderRiskSnapshotSchema
);
