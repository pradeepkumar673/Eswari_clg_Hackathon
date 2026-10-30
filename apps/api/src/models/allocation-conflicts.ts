import mongoose, { Schema, Document } from 'mongoose';

export interface IAllocationConflict extends Document {
  sku_id: mongoose.Schema.Types.ObjectId;
  warehouse_id: mongoose.Schema.Types.ObjectId;
  total_requested: number;
  available: number;
  status: 'OPEN' | 'RESOLVED';
  resolved_at: Date | null;
  created_at: Date;
}

const AllocationConflictSchema = new Schema<IAllocationConflict>(
  {
    sku_id: { type: Schema.Types.ObjectId, ref: 'Sku', required: true },
    warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    total_requested: { type: Number, required: true },
    available: { type: Number, required: true },
    status: { type: String, enum: ['OPEN', 'RESOLVED'], default: 'OPEN', required: true },
    resolved_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now, required: true },
  },
  { collection: 'allocation_conflicts' }
);

export const AllocationConflict = mongoose.model<IAllocationConflict>('AllocationConflict', AllocationConflictSchema);
