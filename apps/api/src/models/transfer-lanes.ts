import mongoose, { Schema, Document } from 'mongoose';

export interface ITransferLane extends Document {
  from_warehouse_id: mongoose.Types.ObjectId;
  to_warehouse_id: mongoose.Types.ObjectId;
  transit_hours: number;
  cost_per_unit: number;
  distance_km: number;
  is_active: boolean;
}

const transferLaneSchema = new Schema<ITransferLane>({
  from_warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  to_warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  transit_hours: { type: Number, required: true },
  cost_per_unit: { type: Number, required: true },
  distance_km: { type: Number, required: true },
  is_active: { type: Boolean, required: true, default: true },
}, { collection: 'transfer_lanes' });

transferLaneSchema.index({ from_warehouse_id: 1, to_warehouse_id: 1 }, { unique: true });

export const TransferLane = mongoose.model<ITransferLane>('TransferLane', transferLaneSchema);
