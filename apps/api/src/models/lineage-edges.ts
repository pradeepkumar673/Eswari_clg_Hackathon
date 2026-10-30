import mongoose, { Schema, Document } from 'mongoose';

export interface ILineageEdge extends Document {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  evidence_ids: string[];
  calculation: string;
  observed_at: Date;
  disruption_id?: mongoose.Types.ObjectId | null;
  created_at: Date;
}

const LineageEdgeSchema = new Schema<ILineageEdge>(
  {
    from_type: { type: String, required: true },
    from_id: { type: String, required: true },
    to_type: { type: String, required: true },
    to_id: { type: String, required: true },
    relation: { type: String, required: true },
    evidence_ids: [{ type: String, required: true }],
    calculation: { type: String, required: true },
    observed_at: { type: Date, required: true, default: Date.now },
    disruption_id: { type: Schema.Types.ObjectId, ref: 'Disruption', default: null },
    created_at: { type: Date, default: Date.now, required: true },
  },
  { collection: 'lineage_edges' }
);

LineageEdgeSchema.index({ to_type: 1, to_id: 1 });
LineageEdgeSchema.index({ disruption_id: 1 });

export const LineageEdge = mongoose.model<ILineageEdge>('LineageEdge', LineageEdgeSchema);
