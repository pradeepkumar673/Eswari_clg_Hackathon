import mongoose, { Schema, Document } from 'mongoose';

export interface ISku extends Document {
  code: string;
  name: string;
  unit_cost: number;
  weight_kg: number;
  units_per_slot: number;
  category: string;
  is_critical: boolean;
  is_active: boolean;
  created_at: Date;
}

const skuSchema = new Schema<ISku>({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  unit_cost: { type: Number, required: true },
  weight_kg: { type: Number, required: true },
  units_per_slot: { type: Number, required: true, default: 10 },
  category: { type: String, required: true },
  is_critical: { type: Boolean, required: true, default: false },
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
}, { collection: 'skus' });

export const Sku = mongoose.model<ISku>('Sku', skuSchema);
