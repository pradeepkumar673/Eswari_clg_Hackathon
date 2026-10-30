import mongoose, { Schema, Document } from 'mongoose';

export interface ISourceTrust extends Document {
  source: string;
  trust_level: number;
  tolerance_minutes: number;
}

const SourceTrustSchema = new Schema<ISourceTrust>(
  {
    source: {
      type: String,
      required: true,
      unique: true,
      enum: ['CARRIER_API', 'FIELD_REPORT', 'SUPPLIER_PORTAL', 'CSV', 'EMAIL_TEXT'],
    },
    trust_level: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    tolerance_minutes: {
      type: Number,
      required: true,
    },
  },
  { collection: 'source_trust' }
);

export const SourceTrust = mongoose.model<ISourceTrust>('SourceTrust', SourceTrustSchema);
