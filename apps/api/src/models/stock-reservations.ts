import mongoose, { Schema, Document } from 'mongoose';

export interface IStockReservation extends Document {
  plan_id: mongoose.Types.ObjectId;
  action_id: mongoose.Types.ObjectId;
  warehouse_id: mongoose.Types.ObjectId;
  sku_id: mongoose.Types.ObjectId;
  quantity: number;
  status: 'HELD' | 'RELEASED' | 'CONSUMED';
  reserved_at: Date;
  expires_at: Date | null;
  released_at: Date | null;
}

const StockReservationSchema = new Schema<IStockReservation>(
  {
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', required: true },
    action_id: { type: Schema.Types.ObjectId, ref: 'PlanAction', required: true },
    warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    sku_id: { type: Schema.Types.ObjectId, ref: 'Sku', required: true },
    quantity: { type: Number, required: true },
    status: {
      type: String,
      enum: ['HELD', 'RELEASED', 'CONSUMED'],
      required: true,
      default: 'HELD',
    },
    reserved_at: { type: Date, required: true, default: Date.now },
    expires_at: { type: Date, default: null },
    released_at: { type: Date, default: null },
  },
  { collection: 'stock_reservations' }
);

StockReservationSchema.index({ action_id: 1, warehouse_id: 1, sku_id: 1 }, { unique: true });

export const StockReservation = mongoose.model<IStockReservation>('StockReservation', StockReservationSchema);
