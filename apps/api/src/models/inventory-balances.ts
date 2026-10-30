import mongoose, { Schema, Document } from 'mongoose';

export interface IInventoryBalance extends Document {
  warehouse_id: mongoose.Types.ObjectId;
  sku_id: mongoose.Types.ObjectId;
  on_hand: number;
  reserved: number;
  updated_at: Date;
}

const inventoryBalanceSchema = new Schema<IInventoryBalance>({
  warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  sku_id: { type: Schema.Types.ObjectId, ref: 'Sku', required: true },
  on_hand: { type: Number, required: true, min: 0 },
  reserved: { type: Number, required: true, min: 0 },
  updated_at: { type: Date, required: true, default: Date.now },
}, { collection: 'inventory_balances' });

inventoryBalanceSchema.index({ warehouse_id: 1, sku_id: 1 }, { unique: true });

export const InventoryBalance = mongoose.model<IInventoryBalance>('InventoryBalance', inventoryBalanceSchema);
