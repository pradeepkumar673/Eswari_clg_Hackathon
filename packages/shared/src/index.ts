import { z } from 'zod';

export * from './schemas/core.js';
export * from './schemas/events.js';
export * from './schemas/recovery.js';

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string(),
  uptime: z.number(),
  mongo: z.object({
    connected: z.boolean(),
    transactionsSupported: z.boolean(),
    replicaSet: z.string().nullable()
  }),
  solver: z.object({
    reachable: z.boolean()
  }).optional()
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
