import mongoose, { Schema, Document } from 'mongoose';

export interface IShipment extends Document {
  code: string;
  supplier_id: mongoose.Types.ObjectId;
  warehouse_id: mongoose.Types.ObjectId;
  status: 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
  promised_eta: Date;
  current_eta: Date;
  actual_arrival_at: Date | null;
  carrier_name: string;
  total_units: number;
  usable_quantity: number | null;
  is_disrupted: boolean;
  created_at: Date;
}

const shipmentSchema = new Schema<IShipment>({
  code: { type: String, required: true, unique: true },
  supplier_id: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
  warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  status: { type: String, required: true, enum: ['IN_TRANSIT', 'DELIVERED', 'CANCELLED'] },
  promised_eta: { type: Date, required: true },
  current_eta: { type: Date, required: true },
  actual_arrival_at: { type: Date, default: null },
  carrier_name: { type: String, required: true },
  total_units: { type: Number, required: true },
  usable_quantity: { type: Number, default: null },
  is_disrupted: { type: Boolean, required: true, default: false },
  created_at: { type: Date, default: Date.now },
}, { collection: 'shipments' });

export const Shipment = mongoose.model<IShipment>('Shipment', shipmentSchema);
