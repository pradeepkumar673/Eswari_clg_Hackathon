import mongoose, { Schema, Document } from 'mongoose';

export interface IRiskPolicy extends Document {
  band: 'RED' | 'AMBER' | 'GREEN';
  min_score: number;
  max_score: number;
  description: string;
}

const riskPolicySchema = new Schema<IRiskPolicy>(
  {
    band: { type: String, required: true, unique: true, enum: ['RED', 'AMBER', 'GREEN'] },
    min_score: { type: Number, required: true },
    max_score: { type: Number, required: true },
    description: { type: String, default: '' },
  },
  { collection: 'risk_policies' }
);

export const RiskPolicy = mongoose.model<IRiskPolicy>('RiskPolicy', riskPolicySchema);
