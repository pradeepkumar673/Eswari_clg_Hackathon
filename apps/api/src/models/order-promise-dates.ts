import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderPromiseDate extends Document {
  order_id: mongoose.Schema.Types.ObjectId;
  original_promise: Date;
  current_promise: Date;
  delay_hours: number;
  reason: string;
  updated_at: Date;
}

const OrderPromiseDateSchema = new Schema<IOrderPromiseDate>(
  {
    order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    original_promise: { type: Date, required: true },
    current_promise: { type: Date, required: true },
    delay_hours: { type: Number, required: true },
    reason: { type: String, required: true },
    updated_at: { type: Date, default: Date.now, required: true },
  },
  { collection: 'order_promise_dates' }
);

export const OrderPromiseDate = mongoose.model<IOrderPromiseDate>('OrderPromiseDate', OrderPromiseDateSchema);
