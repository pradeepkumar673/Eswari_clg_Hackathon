import mongoose, { Schema, Document } from 'mongoose';

export interface IHistoricalCase extends Document {
  fingerprint_id: mongoose.Schema.Types.ObjectId;
  disruption_type: string;
  strategy_used: string;
  outcome: string;
  cost: number;
  resolution_hours: number;
  is_seeded: boolean;
  supplier_id?: string | null;
  warehouse_id?: string | null;
  sku_ids?: string[];
  shortage_ratio?: number;
  late_orders?: number;
  what_tried?: string;
  what_worked?: string;
  what_failed?: string;
  why?: string;
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
    supplier_id: { type: String, default: null },
    warehouse_id: { type: String, default: null },
    sku_ids: { type: [String], default: [] },
    shortage_ratio: { type: Number, default: 0 },
    late_orders: { type: Number, default: 0 },
    what_tried: { type: String, default: null },
    what_worked: { type: String, default: null },
    what_failed: { type: String, default: null },
    why: { type: String, default: null },
    created_at: { type: Date, default: Date.now, required: true },
  },
  { collection: 'historical_cases', strict: false }
);

export const HistoricalCase = mongoose.model<IHistoricalCase>('HistoricalCase', HistoricalCaseSchema);
