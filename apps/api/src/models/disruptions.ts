import mongoose, { Schema, Document } from 'mongoose';

export interface IDisruption extends Document {
  shipment_id: mongoose.Types.ObjectId;
  disruption_type: string;
  severity: string;
  usable_quantity: number;
  original_quantity: number;
  delay_hours: number | null;
  detected_at: Date;
  resolved_at: Date | null;
  created_by_event_id: mongoose.Types.ObjectId;
}

const DisruptionSchema = new Schema<IDisruption>(
  {
    shipment_id: {
      type: Schema.Types.ObjectId,
      ref: 'Shipment',
      required: true,
    },
    disruption_type: {
      type: String,
      required: true,
      enum: ['DELAY', 'DAMAGE', 'PARTIAL_LOSS', 'FULL_LOSS'],
    },
    severity: {
      type: String,
      required: true,
      enum: ['RED', 'AMBER', 'GREEN'],
    },
    usable_quantity: {
      type: Number,
      required: true,
    },
    original_quantity: {
      type: Number,
      required: true,
    },
    delay_hours: {
      type: Number,
      default: null,
    },
    detected_at: {
      type: Date,
      required: true,
    },
    resolved_at: {
      type: Date,
      default: null,
    },
    created_by_event_id: {
      type: Schema.Types.ObjectId,
      ref: 'ShipmentEvent',
      required: true,
    },
  },
  { collection: 'disruptions' }
);

export const Disruption = mongoose.model<IDisruption>('Disruption', DisruptionSchema);
