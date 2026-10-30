import mongoose, { Schema, Document } from 'mongoose';

export interface IShipmentLine extends Document {
  shipment_id: mongoose.Types.ObjectId;
  sku_id: mongoose.Types.ObjectId;
  quantity: number;
}

const shipmentLineSchema = new Schema<IShipmentLine>({
  shipment_id: { type: Schema.Types.ObjectId, ref: 'Shipment', required: true },
  sku_id: { type: Schema.Types.ObjectId, ref: 'Sku', required: true },
  quantity: { type: Number, required: true },
}, { collection: 'shipment_lines' });

shipmentLineSchema.index({ shipment_id: 1, sku_id: 1 }, { unique: true });

export const ShipmentLine = mongoose.model<IShipmentLine>('ShipmentLine', shipmentLineSchema);
