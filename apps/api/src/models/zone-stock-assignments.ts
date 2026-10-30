import mongoose, { Schema, Document } from 'mongoose';

export interface IZoneStockAssignment extends Document {
  warehouse_id: string;
  sku_id: string;
  zone_id: string;
  units: number;
  created_at: Date;
}

const zoneStockAssignmentSchema = new Schema<IZoneStockAssignment>({
  warehouse_id: { type: String, required: true, index: true },
  sku_id: { type: String, required: true, index: true },
  zone_id: { type: String, required: true, index: true },
  units: { type: Number, required: true, min: 0 },
  created_at: { type: Date, default: Date.now },
}, { collection: 'zone_stock_assignments' });

zoneStockAssignmentSchema.index({ warehouse_id: 1, sku_id: 1, zone_id: 1 }, { unique: true });

export const ZoneStockAssignment = mongoose.model<IZoneStockAssignment>(
  'ZoneStockAssignment',
  zoneStockAssignmentSchema,
);

