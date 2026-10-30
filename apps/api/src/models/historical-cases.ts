import mongoose, { Schema, Document } from 'mongoose';

export interface IHistoricalCase extends Document {
  fingerprint_id: mongoose.Schema.Types.ObjectId;
  disruption_type: string;
  strategy_used: string;
  outcome: string;
  cost: number;
  resolution_hours: number;
  is_seeded: boolean;
  created_at: Date;
}

const HistoricalCaseSchema = new Schema<IHistoricalCase>(
  {
    fingerprint_id: { type: Schema.Types.ObjectId, ref: 'Fingerprint', required: true },
    disruption_type: { type: String, required: true },
    strategy_used: { type: String, required: true },
    outcome: { type: String, required: true },
    cost: { type: Number, required: true },
    resolution_hours: { type: Number, required: true },
    is_seeded: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now, required: true },
  },
  { collection: 'historical_cases' }
);

export const HistoricalCase = mongoose.model<IHistoricalCase>('HistoricalCase', HistoricalCaseSchema);
