/**
 * apps/api/src/services/audit.ts
 *
 * Cryptographic hash chain service for audit_logs and execution_ledger (B17).
 * - row_hash = SHA-256(prev_hash + canonicalJSON(rowContent))
 * - Serialized via atomic update on chain_state document inside transactions.
 * - verifyChain verifies sequential integrity and identifies tampered rows.
 */

import crypto from 'node:crypto';
import mongoose, { ClientSession } from 'mongoose';
import { AuditLog, IAuditLog } from '../models/audit-logs.js';
import { ExecutionLedger, IExecutionLedger } from '../models/execution-ledger.js';
import { ChainState } from '../models/chain-state.js';
import { withTransaction } from '../db/withTransaction.js';

export const GENESIS_HASH = '0'.repeat(64);

/**
 * Deterministic JSON stringifier with recursively sorted keys.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') {
    if (typeof obj === 'number' && !Number.isFinite(obj)) return 'null';
    return JSON.stringify(obj);
  }
  if (obj instanceof Date) {
    return JSON.stringify(obj.toISOString());
  }
  if (obj instanceof mongoose.Types.ObjectId) {
    return JSON.stringify(obj.toString());
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ':' +
          canonicalJson((obj as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

/**
 * Calculates SHA-256 hash of prev_hash + canonical row content.
 */
export function computeRowHash(prevHash: string, content: Record<string, unknown>): string {
  return crypto
    .createHash('sha256')
    .update(prevHash + canonicalJson(content))
    .digest('hex');
}

/**
 * Initializes chain state documents if not yet present.
 */
export async function initChainState(): Promise<void> {
  const chains = ['audit_logs', 'execution_ledger'];
  for (const name of chains) {
    await ChainState.findOneAndUpdate(
      { name },
      {
        $setOnInsert: {
          name,
          last_seq: 0,
          last_hash: GENESIS_HASH,
          updated_at: new Date(),
        },
      },
      { upsert: true, new: true },
    );
  }
}

export interface WriteAuditParams {
  actor?: mongoose.Types.ObjectId | string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  correlationId?: string;
  stepType?: string | null;
}

/**
 * Writes an append-only audit log entry with serialized sequence and hash chain.
 * If session is provided, executes inside caller's transaction.
 * If not provided, wraps in withTransaction to guarantee atomic chain serialization.
 */
export async function writeAudit(
  params: WriteAuditParams,
  session?: ClientSession,
): Promise<IAuditLog> {
  if (!session) {
    return withTransaction(async (s) => writeAudit(params, s));
  }

  // Atomically advance chain_state (serves as serialization lock)
  const state = await ChainState.findOneAndUpdate(
    { name: 'audit_logs' },
    { $inc: { last_seq: 1 }, $set: { updated_at: new Date() } },
    { upsert: true, new: true, session },
  );

  const seq = state.last_seq;
  const prevHash = state.last_hash || GENESIS_HASH;

  const actorId = params.actor
    ? params.actor instanceof mongoose.Types.ObjectId
      ? params.actor
      : new mongoose.Types.ObjectId(params.actor)
    : null;

  const rowContent: Record<string, unknown> = {
    action: params.action,
    actor: actorId ? actorId.toString() : null,
    after: params.after ?? null,
    before: params.before ?? null,
    correlation_id: params.correlationId || 'system',
    entity_id: params.entityId ? String(params.entityId) : null,
    entity_type: params.entityType ?? null,
    seq,
    step_type: params.stepType ?? null,
  };

  const rowHash = computeRowHash(prevHash, rowContent);

  // Update state with new last_hash
  await ChainState.updateOne(
    { name: 'audit_logs' },
    { $set: { last_hash: rowHash } },
    { session },
  );

  const docArray = await AuditLog.create(
    [
      {
        action: params.action,
        actor: actorId,
        after: params.after ?? null,
        before: params.before ?? null,
        correlation_id: params.correlationId || 'system',
        created_at: new Date(),
        entity_id: params.entityId ? String(params.entityId) : null,
        entity_type: params.entityType ?? null,
        prev_hash: prevHash,
        row_hash: rowHash,
        seq,
        step_type: params.stepType ?? null,
      },
    ],
    { session },
  );

  return docArray[0];
}

export interface WriteLedgerParams {
  planId?: mongoose.Types.ObjectId | string | null;
  actionId?: mongoose.Types.ObjectId | string | null;
  stepType:
    | 'RESERVE'
    | 'TRANSFER_START'
    | 'TRANSFER_COMPLETE'
    | 'ROLLBACK'
    | 'INVENTORY_CORRECTION'
    | 'COMPENSATE'
    | 'QUARANTINE';
  warehouseId?: mongoose.Types.ObjectId | string | null;
  skuId?: mongoose.Types.ObjectId | string | null;
  deltaOnHand?: number | null;
  beforeState: unknown;
  afterState: unknown;
  actor: mongoose.Types.ObjectId | string;
}

/**
 * Writes an append-only execution ledger entry with serialized sequence and hash chain.
 */
export async function writeLedgerEntry(
  params: WriteLedgerParams,
  session?: ClientSession,
): Promise<IExecutionLedger> {
  if (!session) {
    return withTransaction(async (s) => writeLedgerEntry(params, s));
  }

  const state = await ChainState.findOneAndUpdate(
    { name: 'execution_ledger' },
    { $inc: { last_seq: 1 }, $set: { updated_at: new Date() } },
    { upsert: true, new: true, session },
  );

  const seq = state.last_seq;
  const prevHash = state.last_hash || GENESIS_HASH;

  const planId = params.planId
    ? params.planId instanceof mongoose.Types.ObjectId
      ? params.planId
      : new mongoose.Types.ObjectId(params.planId)
    : null;
  const actionId = params.actionId
    ? params.actionId instanceof mongoose.Types.ObjectId
      ? params.actionId
      : new mongoose.Types.ObjectId(params.actionId)
    : null;
  const actorId =
    params.actor instanceof mongoose.Types.ObjectId
      ? params.actor
      : new mongoose.Types.ObjectId(params.actor);
  const warehouseId = params.warehouseId
    ? params.warehouseId instanceof mongoose.Types.ObjectId
      ? params.warehouseId
      : new mongoose.Types.ObjectId(params.warehouseId)
    : null;
  const skuId = params.skuId
    ? params.skuId instanceof mongoose.Types.ObjectId
      ? params.skuId
      : new mongoose.Types.ObjectId(params.skuId)
    : null;

  const rowContent: Record<string, unknown> = {
    action_id: actionId ? actionId.toString() : null,
    actor: actorId.toString(),
    after_state: params.afterState,
    before_state: params.beforeState,
    delta_on_hand: params.deltaOnHand ?? null,
    plan_id: planId ? planId.toString() : null,
    seq,
    sku_id: skuId ? skuId.toString() : null,
    step_type: params.stepType,
    warehouse_id: warehouseId ? warehouseId.toString() : null,
  };

  const rowHash = computeRowHash(prevHash, rowContent);

  await ChainState.updateOne(
    { name: 'execution_ledger' },
    { $set: { last_hash: rowHash } },
    { session },
  );

  const docs = await ExecutionLedger.create(
    [
      {
        action_id: actionId,
        actor: actorId,
        after_state: params.afterState,
        before_state: params.beforeState,
        delta_on_hand: params.deltaOnHand ?? null,
        executed_at: new Date(),
        plan_id: planId,
        prev_hash: prevHash,
        row_hash: rowHash,
        seq,
        sku_id: skuId,
        step_type: params.stepType,
        warehouse_id: warehouseId,
      },
    ],
    { session },
  );

  return docs[0];
}

export interface VerifyChainResult {
  ok: boolean;
  checked: number;
  firstBrokenRowId?: string;
  error?: string;
}

/**
 * Scans the collection in seq order and recomputes every hash in the chain.
 * Returns ok=true if intact, or names the firstBrokenRowId if tampered or gapped.
 */
export async function verifyChain(
  collection: 'audit_logs' | 'execution_ledger',
): Promise<VerifyChainResult> {
  if (collection === 'audit_logs') {
    const rows = await AuditLog.find({}).sort({ seq: 1 }).lean();
    if (rows.length === 0) {
      return { ok: true, checked: 0 };
    }

    let expectedPrev = GENESIS_HASH;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const expectedSeq = i + 1;

      // Check sequence is strictly gapless starting from 1
      if (row.seq !== expectedSeq) {
        return {
          ok: false,
          checked: i,
          firstBrokenRowId: row._id.toString(),
          error: `Sequence gap or mismatch: expected seq ${expectedSeq}, got ${row.seq}`,
        };
      }

      // Check prev_hash links to prior row
      if (row.prev_hash !== expectedPrev) {
        return {
          ok: false,
          checked: i,
          firstBrokenRowId: row._id.toString(),
          error: `Broken chain link at seq ${row.seq}: prev_hash does not match previous row hash`,
        };
      }

      // Recompute row_hash
      const rowContent: Record<string, unknown> = {
        action: row.action,
        actor: row.actor ? row.actor.toString() : null,
        after: row.after ?? null,
        before: row.before ?? null,
        correlation_id: row.correlation_id,
        entity_id: row.entity_id ? String(row.entity_id) : null,
        entity_type: row.entity_type ?? null,
        seq: row.seq,
        step_type: row.step_type ?? null,
      };

      const computedHash = computeRowHash(row.prev_hash, rowContent);
      if (computedHash !== row.row_hash) {
        return {
          ok: false,
          checked: i,
          firstBrokenRowId: row._id.toString(),
          error: `Row hash mismatch at seq ${row.seq}: row data was altered`,
        };
      }

      expectedPrev = row.row_hash;
    }

    return { ok: true, checked: rows.length };
  } else {
    const rows = await ExecutionLedger.find({}).sort({ seq: 1 }).lean();
    if (rows.length === 0) {
      return { ok: true, checked: 0 };
    }

    let expectedPrev = GENESIS_HASH;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const expectedSeq = i + 1;

      if (row.seq !== expectedSeq) {
        return {
          ok: false,
          checked: i,
          firstBrokenRowId: row._id.toString(),
          error: `Sequence gap or mismatch: expected seq ${expectedSeq}, got ${row.seq}`,
        };
      }

      if (row.prev_hash !== expectedPrev) {
        return {
          ok: false,
          checked: i,
          firstBrokenRowId: row._id.toString(),
          error: `Broken chain link at seq ${row.seq}`,
        };
      }

      const rowContent: Record<string, unknown> = {
        action_id: row.action_id ? row.action_id.toString() : null,
        actor: row.actor.toString(),
        after_state: row.after_state,
        before_state: row.before_state,
        delta_on_hand: row.delta_on_hand ?? null,
        plan_id: row.plan_id ? row.plan_id.toString() : null,
        seq: row.seq,
        sku_id: row.sku_id ? row.sku_id.toString() : null,
        step_type: row.step_type,
        warehouse_id: row.warehouse_id ? row.warehouse_id.toString() : null,
      };

      const computedHash = computeRowHash(row.prev_hash, rowContent);
      if (computedHash !== row.row_hash) {
        return {
          ok: false,
          checked: i,
          firstBrokenRowId: row._id.toString(),
          error: `Row hash mismatch at seq ${row.seq}`,
        };
      }

      expectedPrev = row.row_hash;
    }

    return { ok: true, checked: rows.length };
  }
}
