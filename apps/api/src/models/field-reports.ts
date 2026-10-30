import mongoose, { Schema, Document } from 'mongoose';

export interface IFieldReport extends Document {
  shipment_id: mongoose.Types.ObjectId;
  reporter_user_id: mongoose.Types.ObjectId;
  channel: string;
  raw_text: string;
  extracted_data: {
    delay_hours?: number;
    quantity_affected?: number;
    damage_type?: string;
    confidence?: number;
  };
  llm_used: boolean;
  created_at: Date;
}

const FieldReportSchema = new Schema<IFieldReport>(
  {
    shipment_id: {
      type: Schema.Types.ObjectId,
      ref: 'Shipment',
      required: true,
    },
    reporter_user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    channel: {
      type: String,
      required: true,
      enum: ['VOICE', 'TEXT', 'FORM'],
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
    created_at: {
      type: Date,
      required: true,
    },
  },
  { collection: 'field_reports' }
);

export const FieldReport = mongoose.model<IFieldReport>('FieldReport', FieldReportSchema);
