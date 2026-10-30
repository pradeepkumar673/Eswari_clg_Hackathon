import mongoose, { Schema, Document } from 'mongoose';

export interface IFieldReport extends Document {
  shipment_id?: mongoose.Types.ObjectId | null;
  reporter_user_id: mongoose.Types.ObjectId;
  channel: 'VOICE' | 'TEXT' | 'EMAIL_TEXT' | 'SMS_TEXT' | 'FORM';
  raw_text: string;
  extracted_data: {
    shipment_code?: string;
    warehouse_code?: string;
    delay_hours?: number;
    quantity_affected?: number;
    damaged_units?: number;
    damage_type?: string;
    confidence?: number;
    event_type?: string;
  };
  llm_used: boolean;
  status: 'DRAFT' | 'CONFIRMED' | 'DISCARDED';
  event_id?: mongoose.Types.ObjectId | null;
  created_at: Date;
}

const FieldReportSchema = new Schema<IFieldReport>(
  {
    shipment_id: {
      type: Schema.Types.ObjectId,
      ref: 'Shipment',
      default: null,
    },
    reporter_user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    channel: {
      type: String,
      required: true,
      enum: ['VOICE', 'TEXT', 'EMAIL_TEXT', 'SMS_TEXT', 'FORM'],
    },
    raw_text: {
      type: String,
      required: true,
    },
    extracted_data: {
      type: Schema.Types.Mixed,
      required: true,
    },
    llm_used: {
      type: Boolean,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['DRAFT', 'CONFIRMED', 'DISCARDED'],
      default: 'DRAFT',
    },
    event_id: {
      type: Schema.Types.ObjectId,
      ref: 'ShipmentEvent',
      default: null,
    },
    created_at: {
      type: Date,
      required: true,
    },
  },
  { collection: 'field_reports' }
);

export const FieldReport = mongoose.model<IFieldReport>('FieldReport', FieldReportSchema);
