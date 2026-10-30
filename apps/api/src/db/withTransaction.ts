import mongoose, { ClientSession } from 'mongoose';
import { logger } from '../logger.js';

/**
 * Executes `fn` inside a MongoDB multi-document transaction with automatic
 * retry on TransientTransactionError (up to `maxRetries`).
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
  maxRetries = 3
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        session.startTransaction({
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary'
        });

        const result = await fn(session);

        await session.commitTransaction();
        return result;
      } catch (err: any) {
        lastError = err;
        // Abort the transaction if it is still in progress
        if (session.inTransaction()) {
          await session.abortTransaction();
        }

        // Retry only on transient errors
        if (
          err.hasErrorLabel &&
          err.hasErrorLabel('TransientTransactionError') &&
          attempt < maxRetries - 1
        ) {
          logger.warn(
            { attempt: attempt + 1, maxRetries },
            'TransientTransactionError — retrying transaction'
          );
          continue;
        }

        throw err;
      }
    }
    // Should never reach here, but satisfy TypeScript
    throw lastError;
  } finally {
    await session.endSession();
  }
}

