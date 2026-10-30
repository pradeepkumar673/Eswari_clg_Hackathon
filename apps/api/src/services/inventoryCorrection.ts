/**
 * apps/api/src/services/inventoryCorrection.ts
 *
 * Governed inventory adjustment service.
 * Inventory modifications never directly mutate on_hand:
 * they record audited INVENTORY_CORRECTION entries in the execution_ledger
 * and audit_logs, preserving the cryptographic hash chains and enforcing
 * invariants (on_hand cannot drop below reserved).
 */

import mongoose, { ClientSession } from 'mongoose';
import { InventoryBalance, IInventoryBalance } from '../models/inventory-balances.js';
import { withTransaction } from '../db/withTransaction.js';
import { writeAudit, writeLedgerEntry } from './audit.js';
import { publish } from './bus.js';
import { simClock } from './simClock.js';

export interface InventoryCorrectionParams {
  warehouseId: mongoose.Types.ObjectId | string;
  skuId: mongoose.Types.ObjectId | string;
  newOnHand: number;
  reason: string;
  actor: mongoose.Types.ObjectId | string;
  correlationId?: string;
}

export interface InventoryCorrectionResult {
  balance: IInventoryBalance;
  previousOnHand: number;
  newOnHand: number;
  deltaOnHand: number;
}

/**
 * Applies a governed inventory correction inside a transaction.
 */
export async function applyInventoryCorrection(
  params: InventoryCorrectionParams,
  session?: ClientSession,
): Promise<InventoryCorrectionResult> {
  if (!session) {
    return withTransaction(async (s) => applyInventoryCorrection(params, s));
  }

  const warehouseObjectId =
    params.warehouseId instanceof mongoose.Types.ObjectId
      ? params.warehouseId
      : new mongoose.Types.ObjectId(params.warehouseId);

  const skuObjectId =
    params.skuId instanceof mongoose.Types.ObjectId
      ? params.skuId
      : new mongoose.Types.ObjectId(params.skuId);

  let balance = await InventoryBalance.findOne({
    warehouse_id: warehouseObjectId,
    sku_id: skuObjectId,
  }).session(session);

  let previousOnHand = 0;
  let currentReserved = 0;

  if (balance) {
    previousOnHand = balance.on_hand;
    currentReserved = balance.reserved;

    if (params.newOnHand < currentReserved) {
      const err = new Error(
        `Cannot reduce on_hand below reserved quantity: new on_hand is ${params.newOnHand} but reserved is ${currentReserved}`,
      );
      (err as any).statusCode = 400;
      (err as any).code = 'RESERVATION_VIOLATION';
      throw err;
    }

    balance.on_hand = params.newOnHand;
    balance.updated_at = await simClock.now();
    await balance.save({ session });
  } else {
    if (params.newOnHand < 0) {
      const err = new Error('Inventory on_hand cannot be negative');
      (err as any).statusCode = 400;
      throw err;
    }

    const created = await InventoryBalance.create(
      [
        {
          warehouse_id: warehouseObjectId,
          sku_id: skuObjectId,
          on_hand: params.newOnHand,
          reserved: 0,
          updated_at: await simClock.now(),
        },
      ],
      { session },
    );
    balance = created[0];
  }

  const deltaOnHand = params.newOnHand - previousOnHand;

  // Append to execution_ledger with hash chain
  await writeLedgerEntry(
    {
      stepType: 'INVENTORY_CORRECTION',
      warehouseId: warehouseObjectId,
      skuId: skuObjectId,
      deltaOnHand,
      beforeState: { on_hand: previousOnHand, reserved: currentReserved },
      afterState: { on_hand: params.newOnHand, reserved: currentReserved, reason: params.reason },
      actor: params.actor,
    },
    session,
  );

  // Append to audit_logs with hash chain
  await writeAudit(
    {
      action: 'INVENTORY_CORRECTION',
      actor: params.actor,
      entityType: 'inventory_balances',
      entityId: balance._id.toString(),
      before: { on_hand: previousOnHand, reserved: currentReserved },
      after: { on_hand: params.newOnHand, reserved: currentReserved, reason: params.reason },
      correlationId: params.correlationId || 'inventory-correction',
      stepType: 'INVENTORY_CORRECTION',
    },
    session,
  );

  // Emit event on domain bus
  await publish('INVENTORY_CHANGED', {
    warehouseId: warehouseObjectId.toString(),
    skuId: skuObjectId.toString(),
    previousOnHand,
    newOnHand: params.newOnHand,
    delta: deltaOnHand,
    reason: params.reason,
    actor: String(params.actor),
  });

  return {
    balance,
    previousOnHand,
    newOnHand: params.newOnHand,
    deltaOnHand,
  };
}

