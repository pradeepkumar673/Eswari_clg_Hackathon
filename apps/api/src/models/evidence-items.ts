import mongoose, { Schema, Document } from 'mongoose';

export interface IEvidenceItem extends Document {
  evidence_id: string;
  kind: 'FRAME_SNAPSHOT' | 'CLIP_SEGMENT';
  path: string;
  sha256: string;
  created_at: Date;
}

const evidenceItemSchema = new Schema<IEvidenceItem>({
  evidence_id: { type: String, required: true, unique: true },
  kind: { type: String, required: true, enum: ['FRAME_SNAPSHOT', 'CLIP_SEGMENT'] },
  path: { type: String, required: true },
  sha256: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
}, { collection: 'evidence_items' });

export const EvidenceItem = mongoose.model<IEvidenceItem>('EvidenceItem', evidenceItemSchema);

