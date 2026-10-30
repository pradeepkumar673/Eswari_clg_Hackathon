import mongoose, { Schema, Document } from 'mongoose';
import { Role } from '@disruptioniq/shared';

export interface IUser extends Document {
  username: string;
  password_hash: string;
  role: Role;
  warehouse_id: mongoose.Types.ObjectId | null;
  driver_id: string | null;
  truck_id: string | null;
  supplier_id: string | null;
  display_name: string;
  created_at: Date;
}

const userSchema = new Schema<IUser>({
  username: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  role: {
    type: String,
    required: true,
    enum: [
      'Analyst',
      'Manager',
      'Warehouse_Operator',
      'Procurement_Approver',
      'Administrator',
      'DRIVER',
      'SUPPLIER',
      'Driver',
      'Supplier',
    ],
  },
  warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
  driver_id: { type: String, default: null },
  truck_id: { type: String, default: null },
  supplier_id: { type: String, default: null },
  display_name: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
}, { collection: 'users' });

export const User = mongoose.model<IUser>('User', userSchema);
