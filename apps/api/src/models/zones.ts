import mongoose, { Schema, Document } from 'mongoose';

export interface IZone extends Document {
  zone_id: string;
  warehouse_id: string;
  name: string;
  zone_type: 'RECEIVING' | 'STORAGE' | 'DISPATCH' | 'QUARANTINE';
  polygon: Array<[number, number]>;
  capacity_slots: number;
  reserved_inbound_slots: number;
  version: number;
  is_active: boolean;
  deleted_at: Date | null;
  created_at: Date;
}

const zoneSchema = new Schema<IZone>({
  zone_id: { type: String, required: true, unique: true },
  warehouse_id: { type: String, required: true, index: true },
  name: { type: String, required: true },
  zone_type: {
    type: String,
    required: true,
    enum: ['RECEIVING', 'STORAGE', 'DISPATCH', 'QUARANTINE'],
  },
  polygon: { type: Schema.Types.Mixed, required: true },
  capacity_slots: { type: Number, required: true, min: 0 },
  reserved_inbound_slots: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: {
      validator: function (this: IZone, val: number) {
        if ((this as any).allow_over_capacity) return true;
        if (this.capacity_slots !== undefined && this.capacity_slots !== null) {
          return val <= this.capacity_slots;
        }
        return true;
      },
      message: 'reserved_inbound_slots must be <= capacity_slots',
    },
  },
  version: { type: Number, default: 1, min: 1 },
  is_active: { type: Boolean, default: true },
  deleted_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now },
}, { collection: 'zones' });

zoneSchema.index({ warehouse_id: 1, name: 1 }, { unique: true });

export const Zone = mongoose.model<IZone>('Zone', zoneSchema);

