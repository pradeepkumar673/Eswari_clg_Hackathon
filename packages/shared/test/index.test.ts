import { describe, it, expect } from 'vitest';
import { HealthResponseSchema } from '../src/index';

describe('Shared package schemas', () => {
  it('validates a correct health response payload', () => {
    const payload = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: 120,
      mongo: {
        connected: true,
        transactionsSupported: true,
        replicaSet: 'rs0'
      }
    };
    const parsed = HealthResponseSchema.parse(payload);
    expect(parsed.status).toBe('ok');
    expect(parsed.mongo.transactionsSupported).toBe(true);
  });
});

