import { app } from './app.js';
import { connectDB } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';

async function bootstrap() {
  await connectDB();
  app.listen(config.PORT, () => {
    logger.info(`DisruptionIQ API server running on port ${config.PORT}`);
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Fatal bootstrap error');
  process.exit(1);
});

