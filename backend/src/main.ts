import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';

import { config } from './config';
import { logger, createRequestLogger } from './common/logger';
import { errorHandler } from './common/errors';
import { requestId, responseTime, sanitizeResponse } from './common/middleware';
import { requireAdminKey } from './common/guards';
import { metricsMiddleware, getMetrics, getContentType } from './infrastructure/metrics/prometheus';
import { checkDatabaseConnection } from './database/connection';
import { runMigrations } from './database/migrations/001_initial_schema';
import { runSeeds } from './database/seeds/run-seeds';
import { redisClient } from './infrastructure/redis/cache.service';
import { WebSocketService } from './infrastructure/websocket/ws.service';
import { AnalyticsService } from './modules/analytics/analytics.service';
import { ActivityService } from './modules/activity/activity.service';
import { OrderBookService } from './modules/orders/orderbook.service';
import { startScheduledJobs } from './infrastructure/jobs/scheduler';
import { startWorkers, scheduleRecurringJobs, shutdownQueues } from './infrastructure/queue/queues';
import { PolymarketClient } from './modules/ingest/polymarket.client';
import { IngestService } from './modules/ingest/ingest.service';
import { MarketMakerService } from './modules/bots/market-maker.service';

// Routers
import { authRouter } from './modules/auth/auth.router';
import { usersRouter } from './modules/users/users.router';
import { marketsRouter } from './modules/markets/markets.router';
import { tradingRouter } from './modules/trading/trading.router';
import { ordersRouter } from './modules/orders/orders.router';
import { portfolioRouter } from './modules/portfolio/portfolio.router';
import { analyticsRouter } from './modules/analytics/analytics.router';
import { activityRouter } from './modules/activity/activity.router';
import { adminRouter } from './modules/admin/admin.router';
import { economyRouter } from './modules/economy/economy.router';
import { NotificationService } from './modules/notifications/notification.service';
import { notificationRouter } from './modules/notifications/notification.router';

async function bootstrap(): Promise<void> {
  // ── Validate connections
  await checkDatabaseConnection();
  await runMigrations();
  if (config.SEED_ON_START) {
    await runSeeds();
  }

  const app = express();
  const httpServer = createServer(app);

  // ── Service instances (DI via app.locals)
  const wsService = new WebSocketService();
  const activityService = new ActivityService();
  const analyticsService = new AnalyticsService();
  const notificationService = new NotificationService(wsService);
  const orderBookService = new OrderBookService(wsService, activityService, notificationService);
  const marketMakerService = new MarketMakerService(orderBookService);
  const ingestService = new IngestService(new PolymarketClient(), marketMakerService, orderBookService);

  app.locals.wsService = wsService;
  app.locals.analyticsService = analyticsService;
  app.locals.activityService = activityService;
  app.locals.orderBookService = orderBookService;
  app.locals.ingestService = ingestService;
  app.locals.marketMakerService = marketMakerService;
  app.locals.notificationService = notificationService;

  // ── WebSocket
  wsService.initialize(httpServer);

  // ── Security middleware
  if (config.NODE_ENV === 'production') {
    // Behind a reverse proxy (nginx etc.): trust the first hop so req.ip
    // reflects the real client for rate limiting and webhook IP checks.
    app.set('trust proxy', 1);
  }

  app.use(helmet({
    contentSecurityPolicy: config.NODE_ENV === 'production',
    crossOriginEmbedderPolicy: config.NODE_ENV === 'production',
  }));

  app.use(cors({
    origin: config.NODE_ENV === 'production'
      ? process.env.ALLOWED_ORIGINS?.split(',') ?? []
      : '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
  }));

  // ── Rate limiting
  const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests, please try again later',
          timestamp: new Date().toISOString(),
        },
      });
    },
  });

  // Stricter rate limit for trading endpoints
  const tradingLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
  });

  // Auth endpoints limiter
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000, // 15 min
    max: 20,
    keyGenerator: (req) => req.ip ?? 'unknown',
  });

  // Economy endpoints limiter (shop, ad rewards)
  const economyLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
  });

  // ── General middleware
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(requestId());
  app.use(responseTime());
  app.use(sanitizeResponse());
  app.use(metricsMiddleware());
  app.use(createRequestLogger());

  // ── Health & Metrics (no rate limit)
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: process.env.npm_package_version ?? '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  const opsAuth = config.NODE_ENV === 'production' ? [requireAdminKey] : [];

  app.get('/health/detailed', ...opsAuth, async (_req, res) => {
    const checks = await Promise.allSettled([
      checkDatabaseConnection(),
      redisClient.ping(),
    ]);

    const [dbCheck, redisCheck] = checks;

    res.json({
      status: checks.every((c) => c.status === 'fulfilled') ? 'ok' : 'degraded',
      checks: {
        database: dbCheck.status === 'fulfilled' ? 'ok' : 'error',
        redis: redisCheck.status === 'fulfilled' ? 'ok' : 'error',
        websocket: wsService.getStats(),
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/metrics', ...opsAuth, async (_req, res) => {
    res.set('Content-Type', getContentType());
    res.end(await getMetrics());
  });

  // ── API Routes
  const apiV1 = `/api/${config.API_VERSION}`;

  app.use(`${apiV1}/auth`, authLimiter, authRouter);
  app.use(`${apiV1}/users`, limiter, usersRouter);
  app.use(`${apiV1}/markets`, limiter, marketsRouter);
  app.use(`${apiV1}/trading`, tradingLimiter, tradingRouter);
  app.use(`${apiV1}/orders`, limiter, ordersRouter);
  app.use(`${apiV1}/portfolio`, limiter, portfolioRouter);
  app.use(`${apiV1}/analytics`, limiter, analyticsRouter);
  app.use(`${apiV1}/activity`, limiter, activityRouter);
  app.use(`${apiV1}/admin`, limiter, adminRouter);
  app.use(`${apiV1}/economy`, economyLimiter, economyRouter);
  app.use(`${apiV1}/notifications`, limiter, notificationRouter);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ── Error handler (must be last)
  app.use(errorHandler);

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
  httpServer.listen(config.PORT, () => {
    logger.info(`🚀 Server running on port ${config.PORT}`, {
      env: config.NODE_ENV,
      apiBase: apiV1,
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
