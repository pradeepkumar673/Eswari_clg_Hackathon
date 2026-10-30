/**
 * apps/api/src/models/driver-incidents.ts
 * A breakdown or accident reported from the driver portal, with the live position at the time of the report.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IDriverIncident extends Document {
  incident_id: string;
  driver_id: string;
  driver_name: string | null;
  truck_id: string;
  kind: 'BREAKDOWN' | 'ACCIDENT' | 'DELAY_OTHER';
  ts: Date;
  status: string; // REPORTED | CLEARED
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  warehouse_id: string | null; // destination warehouse (ObjectId as string)
  destination_code: string | null;
  proposal_id: string | null;
  idempotency_key: string;
  cleared_at: Date | null;
  cleared_by: string | null;
  created_at: Date;
}

const driverIncidentSchema = new Schema<IDriverIncident>(
  {
    incident_id: { type: String, required: true, unique: true },
    driver_id: { type: String, required: true, index: true },
    driver_name: { type: String, default: null },
    truck_id: { type: String, required: true, index: true },
    kind: { type: String, required: true, enum: ['BREAKDOWN', 'ACCIDENT', 'DELAY_OTHER'] },
    ts: { type: Date, required: true },
    status: { type: String, required: true, default: 'REPORTED' },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    accuracy_m: { type: Number, default: null },
    warehouse_id: { type: String, default: null },
    destination_code: { type: String, default: null },
    proposal_id: { type: String, default: null },
    idempotency_key: { type: String, required: true },
    cleared_at: { type: Date, default: null },
    cleared_by: { type: String, default: null },
    created_at: { type: Date, default: Date.now },
  },
  { collection: 'driver_incidents' },
);

driverIncidentSchema.index({ driver_id: 1, idempotency_key: 1 }, { unique: true });
driverIncidentSchema.index({ status: 1, created_at: -1 });

export const DriverIncident = mongoose.model<IDriverIncident>('DriverIncident', driverIncidentSchema);
