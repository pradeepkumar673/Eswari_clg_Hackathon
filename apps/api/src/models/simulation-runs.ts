import mongoose, { Schema, Document } from 'mongoose';

export interface ISimulationRun extends Document {
  name?: string;
  scenario?: any;
  results?: any;
  run_by?: mongoose.Types.ObjectId | null;
  run_at: Date;
}

const simulationRunSchema = new Schema<ISimulationRun>(
  {
    name: { type: String, default: '' },
    scenario: { type: Schema.Types.Mixed, default: {} },
    results: { type: Schema.Types.Mixed, default: {} },
    run_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    run_at: { type: Date, default: Date.now },
  },
  { collection: 'simulation_runs' }
);

simulationRunSchema.index({ run_at: -1 });

export const SimulationRun = mongoose.model<ISimulationRun>('SimulationRun', simulationRunSchema);
