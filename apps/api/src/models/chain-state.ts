import mongoose, { Schema, Document } from 'mongoose';

export interface IChainState extends Document {
  name: string; // 'audit_logs' | 'execution_ledger'
  last_seq: number;
  last_hash: string;
  updated_at: Date;
}

const ChainStateSchema = new Schema<IChainState>(
  {
    name: { type: String, required: true, unique: true },
    last_seq: { type: Number, required: true, default: 0 },
    last_hash: { type: String, required: true, default: '0'.repeat(64) },
    updated_at: { type: Date, required: true, default: Date.now },
  },
  { collection: 'chain_state' }
);

export const ChainState = mongoose.model<IChainState>('ChainState', ChainStateSchema);
