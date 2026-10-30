import mongoose, { Schema, Document } from 'mongoose';

export interface IRouteOption extends Document {
  plan_id: mongoose.Schema.Types.ObjectId;
  label: string;
  hops: Array<{ from: string; to: string; mode: string; hours: number; cost: number }>;
  total_hours: number;
  total_cost: number;
  co2_kg: number;
  is_selected: boolean;
}

const RouteOptionSchema = new Schema<IRouteOption>(
  {
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', required: true },
    label: { type: String, required: true },
    hops: [{ type: Schema.Types.Mixed }],
    total_hours: { type: Number, required: true },
    total_cost: { type: Number, required: true },
    co2_kg: { type: Number, required: true },
    is_selected: { type: Boolean, default: false },
  },
  { collection: 'route_options' }
);

export const RouteOption = mongoose.model<IRouteOption>('RouteOption', RouteOptionSchema);
