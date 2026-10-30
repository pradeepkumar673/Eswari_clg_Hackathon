import mongoose, { ClientSession } from 'mongoose';
import { logger } from '../logger.js';

/**
 * Executes `fn` inside a MongoDB multi-document transaction with automatic
 * retry on TransientTransactionError and write conflicts (up to `maxRetries`).
 *
 * LOCK-ORDER RULE: When modifying inventory_balances inside a transaction,
 * always sort operations by (warehouse_id, sku_id) ascending BEFORE issuing
 * any writes.  This prevents deadlocks when multiple concurrent transactions
 * touch overlapping inventory rows.
 *
 * Usage:
 *   const result = await withTransaction(async (session) => {
 *     await InventoryBalance.updateOne(filter, update, { session });
 *     await AuditLog.create([doc], { session });
 *     return 'done';
 *   });
 */
export async function withTransaction<T>(
  fn: (session: ClientSession) => Promise<T>,
  maxRetries = 25,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        session.startTransaction({
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
        });

        const result = await fn(session);

        await session.commitTransaction();
        return result;
      } catch (err: any) {
        lastError = err;
        // Abort the transaction if it is still in progress
        if (session.inTransaction()) {
          try {
            await session.abortTransaction();
          } catch {
            // Ignore abort error
          }
        }

        const isTransient =
          (typeof err.hasErrorLabel === 'function' &&
            err.hasErrorLabel('TransientTransactionError')) ||
          err.code === 112 ||
          (typeof err.message === 'string' && err.message.includes('Write conflict'));

        if (isTransient && attempt < maxRetries - 1) {
          // Jittered backoff to avoid thundering herd on write conflict
          const jitter = Math.floor(Math.random() * 25) + 10;
          const delay = Math.min(300, 10 * Math.pow(1.3, attempt) + jitter);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        throw err;
      }
    }
    throw lastError;
  } finally {
    await session.endSession();
  }
}
