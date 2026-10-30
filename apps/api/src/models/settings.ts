import mongoose, { Schema, Document } from 'mongoose';

export interface ISetting extends Document {
  key: string;
  value: any;
  updated_at: Date;
}

const settingSchema = new Schema<ISetting>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'settings' }
);

export const Setting = mongoose.model<ISetting>('Setting', settingSchema);
