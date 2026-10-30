import mongoose, { Schema, Document } from 'mongoose';

export interface ILineageEdge extends Document {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  created_at: Date;
}

const LineageEdgeSchema = new Schema<ILineageEdge>(
  {
    from_type: { type: String, required: true },
    from_id: { type: String, required: true },
    to_type: { type: String, required: true },
    to_id: { type: String, required: true },
    relation: { type: String, required: true },
    created_at: { type: Date, default: Date.now, required: true },
  },
  { collection: 'lineage_edges' }
);

export const LineageEdge = mongoose.model<ILineageEdge>('LineageEdge', LineageEdgeSchema);
