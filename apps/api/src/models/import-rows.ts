import mongoose, { Schema, Document } from 'mongoose';

export interface IImportRowData {
  batch_id: mongoose.Types.ObjectId;
  row_number: number;
  entity_type: string;
  natural_key?: string | null;
  raw_data: Record<string, unknown>;
  repaired_data?: Record<string, unknown> | null;
  status: string;
  // Named import_errors to avoid clash with Mongoose Document.errors
  import_errors: Array<{
    field?: string;
    code: string;
    message: string;
    suggestion?: string;
  }>;
  shipment_event_id: mongoose.Types.ObjectId | null;
}

export interface IImportRow extends Omit<Document, 'errors'>, IImportRowData {}

const ImportRowSchema = new Schema<IImportRow>(
  {
    batch_id: {
      type: Schema.Types.ObjectId,
      ref: 'ImportBatch',
      required: true,
      index: true,
    },
    row_number: {
      type: Number,
      required: true,
    },
    entity_type: {
      type: String,
      required: true,
    },
    natural_key: {
      type: String,
      default: null,
      index: true,
    },
    raw_data: {
      type: Schema.Types.Mixed,
      required: true,
    },
    repaired_data: {
      type: Schema.Types.Mixed,
      default: null,
    },
    status: {
      type: String,
      required: true,
      enum: ['VALID', 'REPAIRED', 'QUARANTINED', 'DISCARDED', 'DUPLICATE', 'CONFLICT'],
      index: true,
    },
    import_errors: {
      type: Schema.Types.Mixed,
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
