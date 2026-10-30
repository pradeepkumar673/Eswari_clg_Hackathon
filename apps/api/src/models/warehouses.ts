import mongoose, { Schema, Document } from 'mongoose';

export interface IWarehouse extends Document {
  code: string;
  name: string;
  map_x: number;
  map_y: number;
  processing_hours: number;
  is_hub: boolean;
  is_active: boolean;
  created_at: Date;
}

const warehouseSchema = new Schema<IWarehouse>({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  map_x: { type: Number, required: true, min: 0, max: 1000 },
  map_y: { type: Number, required: true, min: 0, max: 1000 },
  processing_hours: { type: Number, required: true, default: 2 },
  is_hub: { type: Boolean, required: true, default: false },
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
}, { collection: 'warehouses', strict: false });

export const Warehouse = mongoose.model<IWarehouse>('Warehouse', warehouseSchema);
