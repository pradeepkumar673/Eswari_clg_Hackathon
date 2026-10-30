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
  // Reconciler fields (Step 5B)
  resolved_eta: Date | null;
  eta_basis_event_id: mongoose.Types.ObjectId | null;
  review_status: 'NORMAL' | 'UNDER_REVIEW' | null;
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
  resolved_eta: { type: Date, default: null },
  eta_basis_event_id: { type: Schema.Types.ObjectId, ref: 'ShipmentEvent', default: null },
  review_status: {
    type: String,
    enum: ['NORMAL', 'UNDER_REVIEW', null],
    default: null,
  },
}, { collection: 'shipments' });

export const Shipment = mongoose.model<IShipment>('Shipment', shipmentSchema);
