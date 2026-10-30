// INSERT-ONLY: No updates or deletes allowed (enforced by Mongo roles)
import mongoose, { Schema, Document } from 'mongoose';

export interface IExecutionLedger extends Document {
  plan_id: mongoose.Types.ObjectId;
  action_id: mongoose.Types.ObjectId;
  step_type: string;
  before_state: any;
  after_state: any;
  actor: mongoose.Types.ObjectId;
  seq: number;
  prev_hash: string;
  row_hash: string;
  executed_at: Date;
}

const ExecutionLedgerSchema = new Schema<IExecutionLedger>(
  {
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', required: true },
    action_id: { type: Schema.Types.ObjectId, ref: 'PlanAction', required: true },
    step_type: {
      type: String,
      enum: ['RESERVE', 'TRANSFER_START', 'TRANSFER_COMPLETE', 'ROLLBACK'],
      required: true,
    },
    before_state: { type: Schema.Types.Mixed, required: true },
    after_state: { type: Schema.Types.Mixed, required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    seq: { type: Number, required: true },
    prev_hash: { type: String, required: true },
    row_hash: { type: String, required: true },
    executed_at: { type: Date, required: true, default: Date.now },
  },
  { collection: 'execution_ledger' }
);

export const ExecutionLedger = mongoose.model<IExecutionLedger>('ExecutionLedger', ExecutionLedgerSchema);
