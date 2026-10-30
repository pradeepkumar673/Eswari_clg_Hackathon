import mongoose, { Schema, Document } from 'mongoose';

export interface IStressRun extends Document {
  scenario_name: string;
  parameters: any;
  results: any;
  passed: boolean;
  run_at: Date;
  run_by?: mongoose.Types.ObjectId | null;
}

const stressRunSchema = new Schema<IStressRun>(
  {
    scenario_name: { type: String, required: true },
    parameters: { type: Schema.Types.Mixed, default: {} },
    results: { type: Schema.Types.Mixed, default: {} },
    passed: { type: Boolean, required: true },
    run_at: { type: Date, default: Date.now },
    run_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'stress_runs' }
);

stressRunSchema.index({ run_at: -1 });

export const StressRun = mongoose.model<IStressRun>('StressRun', stressRunSchema);
