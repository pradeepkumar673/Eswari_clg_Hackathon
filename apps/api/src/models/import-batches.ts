import mongoose, { Schema, Document } from 'mongoose';

export interface IImportBatch extends Document {
  filename: string;
  file_hash: string;
  entity_type: string;
  status: string;
  uploaded_by: mongoose.Types.ObjectId;
  row_count: number;
  error_count: number;
  valid_count: number;
  repaired_count: number;
  quarantined_count: number;
  duplicate_count: number;
  conflict_count: number;
  discarded_count: number;
  raw_content?: string;
  created_at: Date;
  committed_at: Date | null;
}

const ImportBatchSchema = new Schema<IImportBatch>(
  {
    filename: {
      type: String,
      required: true,
    },
    file_hash: {
      type: String,
      required: true,
    },
    entity_type: {
      type: String,
      required: true,
      enum: ['shipments', 'orders', 'inventory', 'supplier_skus', 'transfer_lanes'],
    },
    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'VALIDATED', 'COMMITTED', 'REJECTED'],
    },
    uploaded_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    row_count: {
      type: Number,
      required: true,
      default: 0,
    },
    error_count: {
      type: Number,
      required: true,
      default: 0,
    },
    valid_count: {
      type: Number,
      required: true,
      default: 0,
    },
    repaired_count: {
      type: Number,
      required: true,
      default: 0,
    },
    quarantined_count: {
      type: Number,
      required: true,
      default: 0,
    },
    duplicate_count: {
      type: Number,
      required: true,
      default: 0,
    },
    conflict_count: {
      type: Number,
      required: true,
      default: 0,
    },
    discarded_count: {
      type: Number,
      required: true,
      default: 0,
    },
    raw_content: {
      type: String,
      default: '',
    },
    created_at: {
      type: Date,
      required: true,
    },
    committed_at: {
      type: Date,
      default: null,
    },
  },
  { collection: 'import_batches' }
);

ImportBatchSchema.index(
  { file_hash: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'COMMITTED' },
  }
);

export const ImportBatch = mongoose.model<IImportBatch>('ImportBatch', ImportBatchSchema);
