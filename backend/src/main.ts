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
import { metricsMiddleware, getMetrics, getContentType } from './infrastructure/metrics/prometheus';
import { checkDatabaseConnection } from './database/connection';
import { redisClient } from './infrastructure/redis/cache.service';
import { WebSocketService } from './infrastructure/websocket/ws.service';
import { LMSREngine } from './modules/trading/lmsr.engine';
import { AnalyticsService } from './modules/analytics/analytics.service';
import { ActivityService } from './modules/activity/activity.service';
import { OrderBookService } from './modules/orders/orderbook.service';
import { startScheduledJobs } from './infrastructure/jobs/scheduler';
import { startWorkers, scheduleRecurringJobs, shutdownQueues } from './infrastructure/queue/queues';

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

async function bootstrap(): Promise<void> {
  // ── Validate connections
  await checkDatabaseConnection();

  const app = express();
  const httpServer = createServer(app);

  // ── Service instances (DI via app.locals)
  const wsService = new WebSocketService();
  const activityService = new ActivityService();
  const analyticsService = new AnalyticsService();
  const lmsrEngine = new LMSREngine(wsService, activityService);
  const orderBookService = new OrderBookService(wsService, activityService);

  app.locals.wsService = wsService;
  app.locals.lmsrEngine = lmsrEngine;
  app.locals.analyticsService = analyticsService;
  app.locals.activityService = activityService;
  app.locals.orderBookService = orderBookService;

  // ── WebSocket
  wsService.initialize(httpServer);

  // ── Security middleware
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

  app.get('/health/detailed', async (_req, res) => {
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

  app.get('/metrics', async (_req, res) => {
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
    startScheduledJobs();
    startWorkers(analyticsService, orderBookService);
    await scheduleRecurringJobs();
  }

  // ── Start HTTP server
  httpServer.listen(config.PORT, () => {
    logger.info(`🚀 Server running on port ${config.PORT}`, {
      env: config.NODE_ENV,
      apiBase: apiV1,
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
