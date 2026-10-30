import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { checkTransactionsSupported } from './db.js';
import { config } from './config.js';

export const app = express();

app.use(cors());
app.use(express.json());

// Health route that reports mongo connection AND transaction support
app.get('/api/v1/health', async (_req: Request, res: Response) => {
  const isConnected = mongoose.connection.readyState === 1;
  const transactionsSupported = isConnected ? await checkTransactionsSupported() : false;
  
  // Extract replica set name if present
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
      replicaSet: replicaSetName
    }
  });
});

// Error handling middleware returning { error: { code, message, details } }
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected error occurred',
      details: err.details || null
    }
  });
});

