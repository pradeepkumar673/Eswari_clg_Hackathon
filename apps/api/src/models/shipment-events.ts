// INSERT-ONLY: No updates or deletes allowed (enforced by Mongo roles)
import mongoose, { Schema, Document } from 'mongoose';

export interface IShipmentEvent extends Document {
  shipment_id: mongoose.Types.ObjectId;
  source: string;
  external_event_id: string | null;
  event_type: string;
  reported_eta: Date | null;
  quantity_affected: number | null;
  confidence: number;
  raw_payload: Record<string, unknown>;
  ingested_at: Date;
  // Reconciler fields (Step 5B)
  event_time: Date | null;
  reconcile_status: 'APPLIED' | 'DUPLICATE' | 'STALE' | 'CONFLICT' | 'REJECTED' | null;
  reconcile_reason: string | null;
}

const ShipmentEventSchema = new Schema<IShipmentEvent>(
  {
    shipment_id: {
      type: Schema.Types.ObjectId,
      ref: 'Shipment',
      required: true,
    },
    source: {
      type: String,
      required: true,
      enum: ['CARRIER_API', 'FIELD_REPORT', 'SUPPLIER_PORTAL', 'CSV', 'EMAIL_TEXT', 'CCTV'],
    },
    external_event_id: {
      type: String,
      default: null,
    },
    event_type: {
      type: String,
      required: true,
      enum: [
        'DELAY',
        'ETA_UPDATE',
        'DAMAGE',
        'PARTIAL_LOSS',
        'DAMAGE_REPORT',
        'DELAY_REPORT',
        'INVENTORY_CORRECTION',
      ],
    },
    reported_eta: {
      type: Date,
      default: null,
    },
    quantity_affected: {
      type: Number,
      default: null,
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    raw_payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    ingested_at: {
      type: Date,
      required: true,
    },
    event_time: {
      type: Date,
      default: null,
    },
    reconcile_status: {
      type: String,
      enum: ['APPLIED', 'DUPLICATE', 'STALE', 'CONFLICT', 'REJECTED', null],
      default: null,
    },
    reconcile_reason: {
      type: String,
      default: null,
    },
  },
  { collection: 'shipment_events' }
);

ShipmentEventSchema.index(
  { source: 1, external_event_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      external_event_id: { $type: 'string' },
    },
  }
);

export const ShipmentEvent = mongoose.model<IShipmentEvent>('ShipmentEvent', ShipmentEventSchema);
