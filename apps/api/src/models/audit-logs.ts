// INSERT-ONLY: No updates or deletes allowed (enforced by Mongo roles)
import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
  actor: mongoose.Types.ObjectId | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before: any;
  after: any;
  correlation_id: string;
  step_type: string | null;
  seq: number;
  prev_hash: string;
  row_hash: string;
  created_at: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    entity_type: { type: String, default: null },
    entity_id: { type: String, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    correlation_id: { type: String, required: true },
    step_type: { type: String, default: null },
    seq: { type: Number, required: true },
    prev_hash: { type: String, required: true },
    row_hash: { type: String, required: true },
    created_at: { type: Date, required: true, default: Date.now },
  },
  { collection: 'audit_logs' }
);

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
