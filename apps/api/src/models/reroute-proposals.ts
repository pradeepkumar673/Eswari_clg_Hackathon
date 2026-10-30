import mongoose, { Schema, Document } from 'mongoose';

export interface IRerouteProposal extends Document {
  proposal_id: string;
  truck_id: string;
  from_position: Record<string, any>;
  nearest_warehouse_id: string;
  road_km: number;
  method: 'ROAD_GRAPH' | 'STRAIGHT_LINE_ESTIMATE';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED_SIMULATED';
  proposed_by: string;
  created_at: Date;
  decided_by: string | null;
  reason: string;
}

const rerouteProposalSchema = new Schema<IRerouteProposal>({
  proposal_id: { type: String, required: true, unique: true },
  truck_id: { type: String, required: true, index: true },
  from_position: { type: Schema.Types.Mixed, required: true },
  nearest_warehouse_id: { type: String, required: true },
  road_km: { type: Number, required: true, min: 0 },
  method: {
    type: String,
    required: true,
    enum: ['ROAD_GRAPH', 'STRAIGHT_LINE_ESTIMATE'],
    default: 'ROAD_GRAPH',
  },
  status: {
    type: String,
    required: true,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED_SIMULATED'],
    default: 'PENDING',
  },
  proposed_by: { type: String, default: 'system' },
  created_at: { type: Date, default: Date.now },
  decided_by: { type: String, default: null },
  reason: { type: String, required: true },
}, { collection: 'reroute_proposals' });

export const RerouteProposal = mongoose.model<IRerouteProposal>('RerouteProposal', rerouteProposalSchema);

