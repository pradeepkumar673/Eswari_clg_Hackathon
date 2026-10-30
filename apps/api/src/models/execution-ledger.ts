// INSERT-ONLY: No updates or deletes allowed (enforced by Mongo roles)
import mongoose, { Schema, Document } from 'mongoose';

export interface IExecutionLedger extends Document {
  plan_id?: mongoose.Types.ObjectId | null;
  action_id?: mongoose.Types.ObjectId | null;
  step_type: string;
  warehouse_id?: mongoose.Types.ObjectId | null;
  sku_id?: mongoose.Types.ObjectId | null;
  delta_on_hand?: number | null;
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
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', required: false, default: null },
    action_id: { type: Schema.Types.ObjectId, ref: 'PlanAction', required: false, default: null },
    step_type: {
      type: String,
      enum: ['RESERVE', 'TRANSFER_START', 'TRANSFER_COMPLETE', 'ROLLBACK', 'INVENTORY_CORRECTION', 'COMPENSATE', 'QUARANTINE'],
      required: true,
    },
    warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: false, default: null },
    sku_id: { type: Schema.Types.ObjectId, ref: 'Sku', required: false, default: null },
    delta_on_hand: { type: Number, required: false, default: null },
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
