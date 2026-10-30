import mongoose, { Schema, Document } from 'mongoose';

export interface ISPOFSnapshot extends Document {
  sku_id?: mongoose.Types.ObjectId | null;
  warehouse_id?: mongoose.Types.ObjectId | null;
  node_type?: string;
  node_id?: string;
  orders_exposed: number;
  penalty_exposure: number;
  has_alternative: boolean;
  qualified_supplier_count?: number;
  is_single_source?: boolean;
  score: number;
  rank?: number;
  snapshot_at: Date;
}

const spofSnapshotSchema = new Schema<ISPOFSnapshot>(
  {
    sku_id: { type: Schema.Types.ObjectId, ref: 'Sku', default: null },
    warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    node_type: { type: String },
    node_id: { type: String },
    orders_exposed: { type: Number, default: 0 },
    penalty_exposure: { type: Number, default: 0 },
    has_alternative: { type: Boolean, default: true },
    qualified_supplier_count: { type: Number },
    is_single_source: { type: Boolean, default: false },
    score: { type: Number, required: true },
    rank: { type: Number },
    snapshot_at: { type: Date, default: Date.now },
  },
  { collection: 'spof_snapshots' }
);

spofSnapshotSchema.index({ snapshot_at: -1 });

export const SPOFSnapshot = mongoose.model<ISPOFSnapshot>('SPOFSnapshot', spofSnapshotSchema);
