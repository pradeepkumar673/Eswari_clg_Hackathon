import mongoose, { Schema, Document } from 'mongoose';

export interface ICctvClip extends Document {
  clip_id: string;
  warehouse_id: string;
  camera_id: string;
  synthetic_spec?: Record<string, any>;
  sha256: string;
  frame_count: number;
  fps: number;
  created_at: Date;
}

const cctvClipSchema = new Schema<ICctvClip>({
  clip_id: { type: String, required: true, unique: true },
  warehouse_id: { type: String, required: true, index: true },
  camera_id: { type: String, required: true },
  synthetic_spec: { type: Schema.Types.Mixed, default: null },
  sha256: { type: String, required: true },
  frame_count: { type: Number, required: true, min: 0 },
  fps: { type: Number, required: true, min: 1 },
  created_at: { type: Date, default: Date.now },
}, { collection: 'cctv_clips' });

export const CctvClip = mongoose.model<ICctvClip>('CctvClip', cctvClipSchema);

