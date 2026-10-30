import mongoose, { Schema, Document } from 'mongoose';

export interface IImportBatch extends Document {
  filename: string;
  file_hash: string;
  status: string;
  uploaded_by: mongoose.Types.ObjectId;
  row_count: number;
  error_count: number;
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
    },
    error_count: {
      type: Number,
      required: true,
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
