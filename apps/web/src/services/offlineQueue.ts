/**
 * apps/web/src/services/offlineQueue.ts
 *
 * Driver offline queue using native browser IndexedDB (strictly no localStorage).
 * Monotonic sequence tracking, batching up to 100 pings, and removing items
 * only after server confirmation or DUPLICATE response.
 */

const DB_NAME = 'disruptioniq_driver_db';
const DB_VERSION = 1;
const STORE_NAME = 'pending_pings';

export interface QueuedPing {
  seq: number;
  ts: string;
  lat: number;
  lng: number;
  speed_kmh: number;
  truck_id?: string;
  driver_id?: string;
  created_at?: number;
  accuracy_m?: number | null;
  heading?: number | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'seq' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Enqueues a ping into IndexedDB.
 */
export async function enqueuePing(ping: QueuedPing): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put({ ...ping, created_at: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves all pending pings ordered by sequence number ascending.
 */
export async function getPendingPings(): Promise<QueuedPing[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const items: QueuedPing[] = req.result || [];
      items.sort((a, b) => a.seq - b.seq);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Gets count of currently pending pings.
 */
export async function getPendingCount(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Removes confirmed or duplicate pings from IndexedDB by sequence numbers.
 */
export async function removePings(seqs: number[]): Promise<void> {
  if (seqs.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const seq of seqs) {
      store.delete(seq);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Flushes pending pings in batches of up to 100 in sequence order.
 * Pings are removed ONLY after the server confirms receipt or reports DUPLICATE.
 */
export async function flushQueue(
  sendBatchFn: (batch: QueuedPing[]) => Promise<{ accepted: number; duplicates: number }>,
): Promise<{ flushed: number; remaining: number }> {
  const allPending = await getPendingPings();
  if (allPending.length === 0) {
    return { flushed: 0, remaining: 0 };
  }

  let totalFlushed = 0;

  // Process in batches of 100
  for (let i = 0; i < allPending.length; i += 100) {
    const batch = allPending.slice(i, i + 100);
    try {
      const res = await sendBatchFn(batch);
      if (res && (res.accepted > 0 || res.duplicates > 0)) {
        const seqsToRemove = batch.map((p) => p.seq);
        await removePings(seqsToRemove);
        totalFlushed += batch.length;
      }
    } catch (err) {
      // Network failure or offline: keep in queue for next flush attempt
      break;
    }
  }

  const remaining = await getPendingCount();
  return { flushed: totalFlushed, remaining };
}

