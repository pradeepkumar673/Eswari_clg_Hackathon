import mongoose, { Schema, Document } from 'mongoose';

export interface IStockThreshold extends Document {
  warehouse_id: mongoose.Types.ObjectId;
  sku_id: mongoose.Types.ObjectId;
  min_quantity: number;
  horizon_hours: number;
}

const stockThresholdSchema = new Schema<IStockThreshold>(
  {
    warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    sku_id: { type: Schema.Types.ObjectId, ref: 'Sku', required: true },
    min_quantity: { type: Number, required: true },
    horizon_hours: { type: Number, default: 72 },
  },
  { collection: 'stock_thresholds' }
);

stockThresholdSchema.index({ warehouse_id: 1, sku_id: 1 }, { unique: true });

export const StockThreshold = mongoose.model<IStockThreshold>('StockThreshold', stockThresholdSchema);
