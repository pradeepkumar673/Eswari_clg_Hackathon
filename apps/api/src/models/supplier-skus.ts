import mongoose, { Schema, Document } from 'mongoose';

export interface ISupplierSku extends Document {
  supplier_id: mongoose.Types.ObjectId;
  sku_id: mongoose.Types.ObjectId;
  warehouse_id: mongoose.Types.ObjectId;
  capacity_per_shipment: number;
  lead_time_hours: number;
  unit_cost: number;
  is_qualified: boolean;
}

const supplierSkuSchema = new Schema<ISupplierSku>({
  supplier_id: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
  sku_id: { type: Schema.Types.ObjectId, ref: 'Sku', required: true },
  warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  capacity_per_shipment: { type: Number, required: true },
  lead_time_hours: { type: Number, required: true },
  unit_cost: { type: Number, required: true },
  is_qualified: { type: Boolean, required: true, default: true },
}, { collection: 'supplier_skus' });

supplierSkuSchema.index({ supplier_id: 1, sku_id: 1, warehouse_id: 1 }, { unique: true });

export const SupplierSku = mongoose.model<ISupplierSku>('SupplierSku', supplierSkuSchema);
