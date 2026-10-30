import mongoose, { Schema, Document } from 'mongoose';

export interface IFingerprint extends Document {
  code: string;
  pattern: Record<string, unknown>;
  occurrence_count: number;
  last_seen_at: Date;
}

const FingerprintSchema = new Schema<IFingerprint>(
  {
    code: { type: String, required: true, unique: true },
    pattern: { type: Schema.Types.Mixed, required: true },
    occurrence_count: { type: Number, default: 0, required: true },
    last_seen_at: { type: Date, required: true },
  },
  { collection: 'fingerprints' }
);

export const Fingerprint = mongoose.model<IFingerprint>('Fingerprint', FingerprintSchema);
