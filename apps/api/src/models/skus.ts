import mongoose, { Schema, Document } from 'mongoose';

export interface ISku extends Document {
  code: string;
  name: string;
  unit_cost: number;
  weight_kg: number;
  category: string;
  is_critical: boolean;
  created_at: Date;
}

const skuSchema = new Schema<ISku>({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  unit_cost: { type: Number, required: true },
  weight_kg: { type: Number, required: true },
  category: { type: String, required: true },
  is_critical: { type: Boolean, required: true, default: false },
  created_at: { type: Date, default: Date.now },
}, { collection: 'skus' });

export const Sku = mongoose.model<ISku>('Sku', skuSchema);
