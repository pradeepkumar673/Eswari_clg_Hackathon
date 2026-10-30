import mongoose, { Schema, Document } from 'mongoose';

export interface IDriverIncident extends Document {
  incident_id: string;
  driver_id: string;
  truck_id: string;
  kind: 'BREAKDOWN' | 'ACCIDENT' | 'DELAY_OTHER';
  ts: Date;
  status: string;
  idempotency_key: string;
  created_at: Date;
}

const driverIncidentSchema = new Schema<IDriverIncident>({
  incident_id: { type: String, required: true, unique: true },
  driver_id: { type: String, required: true, index: true },
  truck_id: { type: String, required: true, index: true },
  kind: { type: String, required: true, enum: ['BREAKDOWN', 'ACCIDENT', 'DELAY_OTHER'] },
  ts: { type: Date, required: true },
  status: { type: String, required: true, default: 'REPORTED' },
  idempotency_key: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
}, { collection: 'driver_incidents' });

driverIncidentSchema.index({ driver_id: 1, idempotency_key: 1 }, { unique: true });

export const DriverIncident = mongoose.model<IDriverIncident>('DriverIncident', driverIncidentSchema);

