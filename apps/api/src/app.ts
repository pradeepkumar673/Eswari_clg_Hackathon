import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { checkTransactionsSupported } from './db.js';
import { authRouter } from './routes/auth.js';
import { auditRouter, adminTamperRouter } from './routes/audit.js';
import { webhookRouter } from './routes/webhooks.js';
import { importsRouter } from './routes/imports.js';
import { eventsRouter } from './routes/events.js';
import { voiceRouter, textIngestRouter, fixturesRouter } from './routes/ingest.js';
import { disruptionsRouter, riskPolicyRouter, evidenceRouter } from './routes/disruptions.js';
import { plansRouter } from './routes/plans.js';
import { approvalsRouter } from './routes/approvals.js';
import { conflictsRouter } from './routes/conflicts.js';
import { guardrailsRouter } from './routes/guardrails.js';
import { overviewRouter } from './routes/overview.js';
import { notificationsRouter } from './routes/notifications.js';
import { alertsRouter } from './routes/alerts.js';
import { detectorsRouter } from './routes/detectors.js';
import { kpisRouter } from './routes/kpis.js';
import { spofRouter } from './routes/spof.js';
import { lineageRouter } from './routes/lineage.js';
import { fingerprintsRouter } from './routes/fingerprints.js';
import { scorecardsRouter } from './routes/scorecards.js';
import { projectionsRouter } from './routes/projections.js';
import { shipmentsRouter } from './routes/shipments.js';
import { masterDataRouter } from './routes/masterdata.js';
import { customerNoticesRouter } from './routes/notices.js';
import { askDeskRouter } from './routes/askDesk.js';
import { whatifRouter } from './routes/whatif.js';
import { adminOpsRouter } from './routes/adminOps.js';
import { trackingRouter } from './routes/tracking.js';
import { driverRealtimeRouter } from './routes/driverRealtime.js';
import { claimsRouter } from './routes/claims.js';
import { cctvRouter } from './routes/cctv.js';
import { zonesRouter } from './routes/zones.js';
import { investigationRouter } from './routes/investigation.js';
import { warehousesRouter } from './routes/warehouses.js';
import { incidentsLiveRouter } from './routes/incidentsLive.js';
import { initNotificationSubscribers } from './services/notifications.js';
import { initLiveQueues } from './services/liveQueues.js';
import { authenticateToken, requirePermission } from './middleware/auth.js';
import { Capability, ROLE_PERMISSIONS } from '@disruptioniq/shared';

// Initialize domain bus event subscribers for notifications & live queues
initNotificationSubscribers();
initLiveQueues();

export const app = express();

// ── Security hardening ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // served via Vite in dev; SPA sets its own
  crossOriginEmbedderPolicy: false,
}));

// Rate-limit: 300 req / 15 min per IP (generous for demo multi-role switching)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health', // never limit health checks
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
});
app.use(limiter);

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

app.use('/api/v1/admin', masterDataRouter);
app.use('/admin', masterDataRouter);

app.use('/api/v1/webhooks', webhookRouter);
app.use('/webhooks', webhookRouter);

app.use('/api/v1/imports', importsRouter);
app.use('/imports', importsRouter);

app.use('/api/v1/events', eventsRouter);
app.use('/events', eventsRouter);

app.use('/api/v1/voice', voiceRouter);
app.use('/voice', voiceRouter);

app.use('/api/v1/ingest', textIngestRouter);
app.use('/ingest', textIngestRouter);

app.use('/api/v1/fixtures', fixturesRouter);
app.use('/fixtures', fixturesRouter);

app.use('/api/v1/disruptions', disruptionsRouter);
app.use('/disruptions', disruptionsRouter);

app.use('/api/v1/risk/policy', riskPolicyRouter);
app.use('/risk/policy', riskPolicyRouter);

app.use('/api/v1/evidence', evidenceRouter);
app.use('/evidence', evidenceRouter);

app.use('/api/v1', plansRouter);
app.use('/', plansRouter);

app.use('/api/v1/approvals', approvalsRouter);
app.use('/approvals', approvalsRouter);

app.use('/api/v1/conflicts', conflictsRouter);
app.use('/conflicts', conflictsRouter);

app.use('/api/v1/guardrails', guardrailsRouter);
app.use('/guardrails', guardrailsRouter);

app.use('/api/v1/overview', overviewRouter);
app.use('/overview', overviewRouter);

app.use('/api/v1/overview', kpisRouter);
app.use('/overview', kpisRouter);

app.use('/api/v1/notifications', notificationsRouter);
app.use('/notifications', notificationsRouter);

app.use('/api/v1/alerts', alertsRouter);
app.use('/alerts', alertsRouter);

app.use('/api/v1/detectors', detectorsRouter);
app.use('/detectors', detectorsRouter);

app.use('/api/v1/risk', spofRouter);
app.use('/risk', spofRouter);

app.use('/api/v1/orders', lineageRouter);
app.use('/orders', lineageRouter);

app.use('/api/v1/fingerprints', fingerprintsRouter);
app.use('/fingerprints', fingerprintsRouter);

app.use('/api/v1/suppliers', scorecardsRouter);
app.use('/suppliers', scorecardsRouter);

app.use('/api/v1/projections', projectionsRouter);
app.use('/projections', projectionsRouter);

app.use('/api/v1/shipments', shipmentsRouter);
app.use('/shipments', shipmentsRouter);

app.use('/api/v1', masterDataRouter);
app.use('/', masterDataRouter);

app.use('/api/v1', customerNoticesRouter);
app.use('/', customerNoticesRouter);

app.use('/api/v1/ask', askDeskRouter);
app.use('/ask', askDeskRouter);

app.use('/api/v1/whatif', whatifRouter);
app.use('/whatif', whatifRouter);

app.use('/api/v1/admin', adminOpsRouter);
app.use('/admin', adminOpsRouter);

// Step 19 & 21 Tracking, Driver, Reroute & Simulation Routers
app.use('/api/v1', trackingRouter);
app.use('/', trackingRouter);
app.use('/api/v1', driverRealtimeRouter);
app.use('/', driverRealtimeRouter);
app.use('/api/v1', investigationRouter);
app.use('/', investigationRouter);

app.use('/api/v1/claims', claimsRouter);
app.use('/claims', claimsRouter);

app.use('/api/v1/cctv', cctvRouter);
app.use('/cctv', cctvRouter);

app.use('/api/v1/zones', zonesRouter);
app.use('/zones', zonesRouter);

app.use('/api/v1/capacity', zonesRouter);
app.use('/capacity', zonesRouter);

app.use('/api/v1', warehousesRouter);
app.use('/', warehousesRouter);

app.use('/api/v1', incidentsLiveRouter);
app.use('/', incidentsLiveRouter);

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
