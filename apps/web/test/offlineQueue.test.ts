/**
 * apps/web/test/offlineQueue.test.ts
 *
 * Acceptance test for Driver Screen Offline Queue:
 * - Go offline, move truck for 10 pings.
 * - Queue holds exactly 10 in monotonic sequence order.
 * - Go online: queue flushes in order in batches of up to 100.
 * - Pings removed only upon server confirmation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueuePing,
  getPendingPings,
  getPendingCount,
  flushQueue,
  QueuedPing,
} from '../src/services/offlineQueue.js';

// Clean in-memory IndexedDB mock for Node.js Vitest environment
class MockIDBDatabase {
  public data = new Map<number, QueuedPing>();

  transaction(_store: string, _mode: string) {
    const self = this;
    return {
      objectStore(_name: string) {
        return {
          put(item: QueuedPing) {
            self.data.set(item.seq, item);
            const req = { onsuccess: () => {}, onerror: () => {} };
            setTimeout(() => req.onsuccess(), 0);
            return req;
          },
          getAll() {
            const items = Array.from(self.data.values());
            const req = { result: items, onsuccess: () => {}, onerror: () => {} };
            setTimeout(() => req.onsuccess(), 0);
            return req;
          },
          count() {
            const req = { result: self.data.size, onsuccess: () => {}, onerror: () => {} };
            setTimeout(() => req.onsuccess(), 0);
            return req;
          },
          delete(seq: number) {
            self.data.delete(seq);
          },
        };
      },
      set oncomplete(fn: () => void) {
        setTimeout(fn, 0);
      },
      set onerror(fn: () => void) {},
    };
  }
}

describe('Driver Screen Offline Queue Acceptance', () => {
  let mockDb: MockIDBDatabase;

  beforeEach(() => {
    mockDb = new MockIDBDatabase();
    (globalThis as any).indexedDB = {
      open: () => {
        const req = {
          result: mockDb,
          onsuccess: () => {},
          onerror: () => {},
          onupgradeneeded: () => {},
        };
        setTimeout(() => req.onsuccess(), 0);
        return req;
      },
    };
  });

  it('enqueues 10 pings offline, flushes them online in seq order, and retains none after confirmation', async () => {
    // 1. Truck moves while offline: 10 pings generated
    for (let i = 1; i <= 10; i++) {
      await enqueuePing({
        seq: i,
        ts: new Date(1700000000000 + i * 1000).toISOString(),
        lat: 12.7409 + i * 0.001,
        lng: 77.8253 + i * 0.001,
        speed_kmh: 60,
        truck_id: 'SHP-204',
        driver_id: 'DRV-1',
      });
    }

    // Verify 10 pending in queue
    const countBefore = await getPendingCount();
    expect(countBefore).toBe(10);

    const pending = await getPendingPings();
    expect(pending).toHaveLength(10);
    // Verified strictly monotonic seq order
    for (let i = 0; i < 10; i++) {
      expect(pending[i].seq).toBe(i + 1);
    }

    // 2. Network reconnects: flushQueue sends batch to server
    const serverReceived: QueuedPing[] = [];
    const flushResult = await flushQueue(async (batch) => {
      serverReceived.push(...batch);
      return { accepted: batch.length, duplicates: 0 };
    });

    // Verify flush result
    expect(flushResult.flushed).toBe(10);
    expect(flushResult.remaining).toBe(0);

    // Verify server holds exactly ten in order
    expect(serverReceived).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(serverReceived[i].seq).toBe(i + 1);
    }

    // Verify queue is now empty
    const countAfter = await getPendingCount();
    expect(countAfter).toBe(0);
  });
});

