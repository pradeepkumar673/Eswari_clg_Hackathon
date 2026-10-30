import mongoose, { Schema, Document } from 'mongoose';

export interface IAlert extends Document {
  alert_key: string;
  type: string;
  severity: 'RED' | 'AMBER' | 'GREEN';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'CLEARED';
  title: string;
  body: string;
  entity_type: string;
  entity_id: string;
  first_seen?: Date;
  last_seen?: Date;
  payload?: any;
  created_at: Date;
  cleared_at?: Date | null;
}

const alertSchema = new Schema<IAlert>(
  {
    alert_key: { type: String, required: true },
    type: { type: String, required: true },
    severity: { type: String, required: true, enum: ['RED', 'AMBER', 'GREEN'] },
    status: {
      type: String,
      required: true,
      enum: ['OPEN', 'ACKNOWLEDGED', 'CLEARED'],
      default: 'OPEN',
    },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    entity_type: { type: String, required: true },
    entity_id: { type: String, required: true },
    first_seen: { type: Date, default: Date.now },
    last_seen: { type: Date, default: Date.now },
    payload: { type: Schema.Types.Mixed, default: {} },
    created_at: { type: Date, default: Date.now },
    cleared_at: { type: Date, default: null },
  },
  { collection: 'alerts' }
);

// Partial unique index: only one OPEN alert per alert_key
alertSchema.index(
  { alert_key: 1 },
  { unique: true, partialFilterExpression: { status: 'OPEN' } }
);

export const Alert = mongoose.model<IAlert>('Alert', alertSchema);
