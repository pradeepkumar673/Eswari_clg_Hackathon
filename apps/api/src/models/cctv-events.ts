import mongoose, { Schema, Document } from 'mongoose';

export interface ICctvEvent extends Document {
  event_id: string;
  clip_id: string;
  track_id: number;
  shipment_id: string | null;
  warehouse_id: string;
  camera_id: string;
  band: 'MINOR' | 'MAJOR' | 'SEVERE';
  damage_score: number;
  components?: Record<string, any>;
  units_damaged: number;
  frame_start: number;
  frame_end: number;
  evidence_ids: string[];
  status: 'DETECTED' | 'LINKED' | 'REJECTED';
  linked_by?: string | null;
  linked_at?: Date | null;
  created_at: Date;
}

const cctvEventSchema = new Schema<ICctvEvent>({
  event_id: { type: String, required: true, unique: true },
  clip_id: { type: String, required: true, index: true },
  track_id: { type: Number, required: true },
  shipment_id: { type: String, default: null, index: true },
  warehouse_id: { type: String, required: true, index: true },
  camera_id: { type: String, required: true },
  band: { type: String, required: true, enum: ['MINOR', 'MAJOR', 'SEVERE'] },
  damage_score: { type: Number, required: true, min: 0, max: 100 },
  components: { type: Schema.Types.Mixed, default: null },
  units_damaged: { type: Number, required: true, min: 0 },
  frame_start: { type: Number, required: true },
  frame_end: { type: Number, required: true },
  evidence_ids: { type: [String], default: [] },
  status: { type: String, required: true, enum: ['DETECTED', 'LINKED', 'REJECTED'], default: 'DETECTED' },
  linked_by: { type: String, default: null },
  linked_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now },
}, { collection: 'cctv_events' });

cctvEventSchema.index({ clip_id: 1, track_id: 1 }, { unique: true });

export const CctvEvent = mongoose.model<ICctvEvent>('CctvEvent', cctvEventSchema);

