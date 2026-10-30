import mongoose, { Schema, Document } from 'mongoose';

export interface IGuardrailPolicy extends Document {
  code: string;
  description: string;
  threshold_value: number;
  threshold_unit: string;
  is_active: boolean;
}

const GuardrailPolicySchema = new Schema<IGuardrailPolicy>(
  {
    code: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    threshold_value: { type: Number, required: true },
    threshold_unit: { type: String, required: true },
    is_active: { type: Boolean, default: true },
  },
  { collection: 'guardrail_policies' }
);

export const GuardrailPolicy = mongoose.model<IGuardrailPolicy>('GuardrailPolicy', GuardrailPolicySchema);
