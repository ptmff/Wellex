import 'express-async-errors';

import { config } from './config';
import { logger } from './common/logger';
import { checkDatabaseConnection } from './database/connection';
import { runMigrations } from './database/migrations/001_initial_schema';
import { runSeeds } from './database/seeds/run-seeds';
import { redisClient } from './infrastructure/redis/cache.service';
import { startScheduledJobs } from './infrastructure/jobs/scheduler';
import { startWorkers, scheduleRecurringJobs, shutdownQueues } from './infrastructure/queue/queues';
import { createApp } from './app';

async function bootstrap(): Promise<void> {
  // ── Validate connections
  await checkDatabaseConnection();
  await runMigrations();
  if (config.SEED_ON_START) {
    await runSeeds();
  }

  const { httpServer, wsService, analyticsService, orderBookService, ingestService } = createApp();

  // ── Start background jobs
  if (config.NODE_ENV !== 'test') {
    startScheduledJobs(ingestService, orderBookService);
    startWorkers(analyticsService, orderBookService);
    await scheduleRecurringJobs();
    if (config.INGEST_ON_START) {
      ingestService.runDailySync().catch((err) => {
        logger.error('Startup ingest failed', { error: (err as Error).message });
      });
    }
  }

  // ── Start HTTP server
  httpServer.listen(config.PORT, config.HOST, () => {
    logger.info(`🚀 Server running on ${config.HOST}:${config.PORT}`, {
      env: config.NODE_ENV,
      apiBase: `/api/${config.API_VERSION}`,
      paymentProvider: config.PAYMENT_PROVIDER,
    });
  });

  // ── Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`);

    httpServer.close(async () => {
      wsService.shutdown();
      await shutdownQueues();
      await redisClient.quit();
      logger.info('✅ Server shut down cleanly');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise rejection', { reason });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});
