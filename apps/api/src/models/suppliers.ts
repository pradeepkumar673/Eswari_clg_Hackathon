import mongoose, { Schema, Document } from 'mongoose';

export interface ISupplier extends Document {
  code: string;
  name: string;
  risk_score: number;
  lead_time_hours: number;
  map_x: number;
  map_y: number;
  on_time_rate: number | null;
  quality_score: number | null;
  is_active: boolean;
  created_at: Date;
}

const supplierSchema = new Schema<ISupplier>({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  risk_score: { type: Number, required: true, min: 0, max: 100 },
  lead_time_hours: { type: Number, required: true },
  map_x: { type: Number, required: true, min: 0, max: 1000 },
  map_y: { type: Number, required: true, min: 0, max: 1000 },
  on_time_rate: { type: Number, default: null, min: 0, max: 1 },
  quality_score: { type: Number, default: null, min: 0, max: 1 },
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
}, { collection: 'suppliers', strict: false });

export const Supplier = mongoose.model<ISupplier>('Supplier', supplierSchema);
