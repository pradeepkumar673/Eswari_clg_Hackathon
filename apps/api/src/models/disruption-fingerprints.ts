import mongoose, { Schema, Document } from 'mongoose';

export interface IDisruptionFingerprint extends Document {
  disruption_id: mongoose.Schema.Types.ObjectId;
  fingerprint_id: mongoose.Schema.Types.ObjectId;
  similarity_score: number;
}

const DisruptionFingerprintSchema = new Schema<IDisruptionFingerprint>(
  {
    disruption_id: { type: Schema.Types.ObjectId, ref: 'Disruption', required: true },
    fingerprint_id: { type: Schema.Types.ObjectId, ref: 'Fingerprint', required: true },
    similarity_score: { type: Number, required: true, min: 0, max: 1 },
  },
  { collection: 'disruption_fingerprints' }
);

export const DisruptionFingerprint = mongoose.model<IDisruptionFingerprint>('DisruptionFingerprint', DisruptionFingerprintSchema);
