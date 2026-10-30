import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  user_id: mongoose.Types.ObjectId;
  type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read: boolean;
  created_at: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['PLAN_READY', 'APPROVAL_NEEDED', 'EXECUTION_COMPLETE'],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    entity_type: { type: String, default: null },
    entity_id: { type: String, default: null },
    read: { type: Boolean, required: true, default: false },
    created_at: { type: Date, required: true, default: Date.now },
  },
  { collection: 'notifications' }
);

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
