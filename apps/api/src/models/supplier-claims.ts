import mongoose, { Schema, Document } from 'mongoose';

export interface ISupplierClaim extends Document {
  claim_id: string;
  supplier_id: string;
  shipment_id: string;
  cctv_event_id: string;
  band: 'MINOR' | 'MAJOR' | 'SEVERE';
  units: number;
  delay_hours: number;
  status: 'OPEN' | 'ACCEPTED' | 'REJECTED' | 'RESPONDED';
  supplier_response: string | null;
  decided_by: string | null;
  linked_by?: string | null;
  rejection_reason?: string | null;
  evidence_ids: string[];
  version: number;
  created_at: Date;
}

const supplierClaimSchema = new Schema<ISupplierClaim>({
  claim_id: { type: String, required: true, unique: true },
  supplier_id: { type: String, required: true, index: true },
  shipment_id: { type: String, required: true, index: true },
  cctv_event_id: { type: String, required: true, index: true },
  band: { type: String, required: true, enum: ['MINOR', 'MAJOR', 'SEVERE'] },
  units: { type: Number, required: true, min: 1 },
  delay_hours: { type: Number, required: true, min: 0 },
  status: {
    type: String,
    required: true,
    enum: ['OPEN', 'ACCEPTED', 'REJECTED', 'RESPONDED'],
    default: 'OPEN',
  },
  supplier_response: { type: String, default: null },
  decided_by: { type: String, default: null },
  linked_by: { type: String, default: null },
  rejection_reason: { type: String, default: null },
  evidence_ids: { type: [String], default: [] },
  version: { type: Number, default: 1, min: 1 },
  created_at: { type: Date, default: Date.now },
}, { collection: 'supplier_claims' });

export const SupplierClaim = mongoose.model<ISupplierClaim>('SupplierClaim', supplierClaimSchema);

