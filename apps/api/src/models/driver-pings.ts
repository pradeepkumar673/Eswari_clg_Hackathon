import mongoose, { Schema, Document } from 'mongoose';

export interface IDriverPing extends Document {
  driver_id: string;
  truck_id: string;
  seq: number;
  ts: Date;
  lat: number;
  lng: number;
  lane_id: string | null;
  km_on_lane: number | null;
  speed_kmh: number;
  accuracy_m?: number | null;
  heading?: number | null;
  source: 'SIM' | 'DRIVER_DEVICE';
  created_at: Date;
}

const driverPingSchema = new Schema<IDriverPing>({
  driver_id: { type: String, required: true, index: true },
  truck_id: { type: String, required: true, index: true },
  seq: { type: Number, required: true },
  ts: { type: Date, required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  lane_id: { type: String, default: null },
  km_on_lane: { type: Number, default: null },
  speed_kmh: { type: Number, required: true, min: 0 },
  accuracy_m: { type: Number, default: null },
  heading: { type: Number, default: null },
  source: { type: String, required: true, enum: ['SIM', 'DRIVER_DEVICE'], default: 'SIM' },
  created_at: { type: Date, default: Date.now },
}, { collection: 'driver_pings' });

driverPingSchema.index({ driver_id: 1, seq: 1 }, { unique: true });

export const DriverPing = mongoose.model<IDriverPing>('DriverPing', driverPingSchema);

