import { app } from './app.js';
import { connectDB } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { ensureIndexes } from './models/index.js';

async function bootstrap() {
  await connectDB();
  await ensureIndexes();
  app.listen(config.PORT, () => {
    logger.info(`DisruptionIQ API server running on port ${config.PORT}`);
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Fatal bootstrap error');
  process.exit(1);
});

