import http from 'node:http';
import { app } from './app.js';
import { connectDB } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { ensureIndexes } from './models/index.js';
import { initChainState } from './services/audit.js';
import { verifyRoutePermissions } from './middleware/routeCheck.js';
import { initWebSocketServer } from './services/websocket.js';

async function bootstrap() {
  await connectDB();
  await ensureIndexes();
  await initChainState();
  verifyRoutePermissions(app);

  const server = http.createServer(app);
  initWebSocketServer(server);

  server.on('error', (e: NodeJS.ErrnoException) => {
    console.error(`Server error (${e.code}) on port ${config.PORT}:`, e.message);
    process.exit(1);
  });

  server.listen(config.PORT, '127.0.0.1', () => {
    logger.info(`DisruptionIQ API server running on port ${config.PORT}`);
    logger.info(`DisruptionIQ WebSocket server attached at /ws`);
  });
}

bootstrap().catch((err) => {
  // console.error so it always shows, even if the pino transport swallows it
  console.error('FATAL BOOTSTRAP ERROR:', err);
  logger.error({ err }, 'Fatal bootstrap error');
  process.exit(1);
});
