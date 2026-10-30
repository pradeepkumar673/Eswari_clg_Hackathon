import mongoose, { Schema, Document } from 'mongoose';

export interface IOrder extends Document {
  code: string;
  customer_name: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'OPEN' | 'RECOVERING' | 'FULFILLED' | 'CANCELLED';
  due_at: Date;
  penalty_per_hour: number;
  total_units: number;
  warehouse_id: mongoose.Types.ObjectId;
  risk_score: number | null;
  risk_band: 'RED' | 'AMBER' | 'GREEN' | null;
  recovery_plan_id: mongoose.Types.ObjectId | null;
  created_at: Date;
}

const orderSchema = new Schema<IOrder>({
  code: { type: String, required: true, unique: true },
  customer_name: { type: String, required: true },
  priority: { type: String, required: true, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
  status: { type: String, required: true, enum: ['OPEN', 'RECOVERING', 'FULFILLED', 'CANCELLED'] },
  due_at: { type: Date, required: true },
  penalty_per_hour: { type: Number, required: true },
  total_units: { type: Number, required: true },
  warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  risk_score: { type: Number, default: null, min: 0, max: 100 },
  risk_band: { type: String, default: null, enum: ['RED', 'AMBER', 'GREEN', null] },
  recovery_plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', default: null },
  created_at: { type: Date, default: Date.now },
}, { collection: 'orders' });

export const Order = mongoose.model<IOrder>('Order', orderSchema);
