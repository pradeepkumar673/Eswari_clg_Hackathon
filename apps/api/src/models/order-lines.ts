import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderLine extends Document {
  order_id: mongoose.Types.ObjectId;
  sku_id: mongoose.Types.ObjectId;
  quantity: number;
}

const orderLineSchema = new Schema<IOrderLine>({
  order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  sku_id: { type: Schema.Types.ObjectId, ref: 'Sku', required: true },
  quantity: { type: Number, required: true },
}, { collection: 'order_lines' });

orderLineSchema.index({ order_id: 1, sku_id: 1 }, { unique: true });

export const OrderLine = mongoose.model<IOrderLine>('OrderLine', orderLineSchema);
