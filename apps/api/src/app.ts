import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { checkTransactionsSupported } from './db.js';
import { authRouter } from './routes/auth.js';
import { auditRouter, adminTamperRouter } from './routes/audit.js';
import { webhookRouter } from './routes/webhooks.js';
import { authenticateToken, requirePermission } from './middleware/auth.js';
import { Capability, ROLE_PERMISSIONS } from '@disruptioniq/shared';

export const app = express();

app.use(cors());

// Capture rawBody for cryptographic HMAC verification on webhooks
app.use(
  express.json({
    verify: (req: Request, _res, buf) => {
      req.rawBody = buf.toString('utf-8');
    },
  }),
);

// Health route handler
async function handleHealth(_req: Request, res: Response): Promise<void> {
  const isConnected = mongoose.connection.readyState === 1;
  const transactionsSupported = isConnected ? await checkTransactionsSupported() : false;

  let replicaSetName: string | null = null;
  if (isConnected && mongoose.connection.db) {
    try {
      const admin = mongoose.connection.db.admin();
      const status = await admin.command({ replSetGetStatus: 1 }).catch(() => null);
      if (status && status.set) {
        replicaSetName = status.set;
      }
    } catch {
      // Ignored
    }
  }

  res.status(isConnected ? 200 : 503).json({
    status: isConnected ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongo: {
      connected: isConnected,
      transactionsSupported,
      replicaSet: replicaSetName,
    },
  });
}

// Health routes
app.get('/api/v1/health', handleHealth);
app.get('/health', handleHealth);

// Mount API routers under both /api/v1 and root prefixes for compatibility
app.use('/api/v1/auth', authRouter);
app.use('/auth', authRouter);

app.use('/api/v1/audit', auditRouter);
app.use('/audit', auditRouter);

app.use('/api/v1/admin', adminTamperRouter);
app.use('/admin', adminTamperRouter);

app.use('/api/v1/webhooks', webhookRouter);
app.use('/webhooks', webhookRouter);

// Capability test router for RBAC verification through real HTTP
const testPermRouter = express.Router();
for (const cap of Object.keys(ROLE_PERMISSIONS) as Capability[]) {
  testPermRouter.get(`/${cap}`, authenticateToken, requirePermission(cap), (req: Request, res: Response) => {
    res.json({ ok: true, capability: cap, role: req.user?.role });
  });
}
// Warehouse-scoped test route
testPermRouter.post('/scoped/:warehouseId', authenticateToken, requirePermission('submit_field_report'), (req: Request, res: Response) => {
  res.json({ ok: true, warehouse_id: req.params.warehouseId });
});

app.use('/api/v1/test/perms', testPermRouter);
app.use('/test/perms', testPermRouter);

// Error handling middleware returning { error: { code, message, details } }
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected error occurred',
      details: err.details || null,
    },
  });
});
