import mongoose, { Schema, Document } from 'mongoose';

export interface IImportRow {
  batch_id: mongoose.Types.ObjectId;
  row_number: number;
  raw_data: Record<string, unknown>;
  status: string;
  errors: unknown[];
  shipment_event_id: mongoose.Types.ObjectId | null;
}

const ImportRowSchema = new Schema<IImportRow>(
  {
    batch_id: {
      type: Schema.Types.ObjectId,
      ref: 'ImportBatch',
      required: true,
    },
    row_number: {
      type: Number,
      required: true,
    },
    raw_data: {
      type: Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['VALID', 'ERROR', 'SKIPPED'],
    },
    errors: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    shipment_event_id: {
      type: Schema.Types.ObjectId,
      ref: 'ShipmentEvent',
      default: null,
    },
  },
  { collection: 'import_rows', suppressReservedKeysWarning: true }
);

export const ImportRow = mongoose.model<IImportRow>('ImportRow', ImportRowSchema);
