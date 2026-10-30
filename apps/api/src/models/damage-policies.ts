import mongoose, { Schema, Document } from 'mongoose';

export interface IDamagePolicy extends Document {
  band: 'MINOR' | 'MAJOR' | 'SEVERE';
  lead_time_hours: number;
  action_description: string;
  requires_supplier_claim: boolean;
  created_at: Date;
}

const damagePolicySchema = new Schema<IDamagePolicy>({
  band: { type: String, required: true, unique: true, enum: ['MINOR', 'MAJOR', 'SEVERE'] },
  lead_time_hours: { type: Number, required: true, min: 0 },
  action_description: { type: String, required: true },
  requires_supplier_claim: { type: Boolean, required: true, default: true },
  created_at: { type: Date, default: Date.now },
}, { collection: 'damage_policies' });

export const DamagePolicy = mongoose.model<IDamagePolicy>('DamagePolicy', damagePolicySchema);

