import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('API Health endpoint', () => {
  it('GET /api/v1/health responds with status structure', async () => {
    const res = await request(app).get('/api/v1/health');
    // Note: If mongo is not connected in unit test, it returns 503 degraded
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('mongo');
    expect(res.body.mongo).toHaveProperty('connected');
    expect(res.body.mongo).toHaveProperty('transactionsSupported');
  });
});

