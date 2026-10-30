import mongoose, { Schema, Document } from 'mongoose';

export interface ISupplierScorecard extends Document {
  supplier_id: mongoose.Types.ObjectId;
  on_time_rate: number;
  quality_score: number;
  total_shipments: number;
  late_shipments: number;
  avg_delay_hours: number;
  last_calculated_at: Date;
}

const supplierScorecardSchema = new Schema<ISupplierScorecard>(
  {
    supplier_id: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, unique: true },
    on_time_rate: { type: Number, required: true, default: 1.0 },
    quality_score: { type: Number, required: true, default: 1.0 },
    total_shipments: { type: Number, required: true, default: 0 },
    late_shipments: { type: Number, required: true, default: 0 },
    avg_delay_hours: { type: Number, required: true, default: 0 },
    last_calculated_at: { type: Date, default: Date.now },
  },
  { collection: 'supplier_scorecards' }
);

export const SupplierScorecard = mongoose.model<ISupplierScorecard>('SupplierScorecard', supplierScorecardSchema);
