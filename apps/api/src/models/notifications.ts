import mongoose, { Schema, Document } from 'mongoose';

export type NotificationChannel = 'IN_APP' | 'EMAIL_SIM' | 'WHATSAPP_SIM';

export interface INotification extends Document {
  user_id: mongoose.Types.ObjectId;
  channel: NotificationChannel;
  trigger: string;
  template_key: string;
  title: string;
  body: string;
  link_type: string;
  link_id: string;
  entity_type: string | null;
  entity_id: string | null;
  dedup_key: string;
  read: boolean;
  created_at: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    channel: {
      type: String,
      enum: ['IN_APP', 'EMAIL_SIM', 'WHATSAPP_SIM'],
      default: 'IN_APP',
      required: true,
    },
    trigger: { type: String, required: true },
    template_key: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    link_type: { type: String, required: true },
    link_id: { type: String, required: true },
    entity_type: { type: String, default: null },
    entity_id: { type: String, default: null },
    dedup_key: { type: String, required: true, unique: true },
    read: { type: Boolean, required: true, default: false },
    created_at: { type: Date, required: true, default: Date.now },
  },
  { collection: 'notifications' }
);

NotificationSchema.index({ user_id: 1, read: 1 });
NotificationSchema.index({ channel: 1, created_at: -1 });

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
