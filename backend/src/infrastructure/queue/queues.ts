import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import { redisClient } from '../redis/cache.service';
import { logger } from '../../common/logger';
import { AnalyticsService } from '../../modules/analytics/analytics.service';
import { OrderBookService } from '../../modules/orders/orderbook.service';
import { db } from '../../database/connection';

const connection = {
  host: redisClient.options.host as string,
  port: redisClient.options.port as number,
};

// ─────────────────────────────────────────────────────────────────
// QUEUE DEFINITIONS
// ─────────────────────────────────────────────────────────────────

export const tradeProcessingQueue = new Queue('trade-processing', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

export const notificationsQueue = new Queue('notifications', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 1000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

export const analyticsQueue = new Queue('analytics', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

export const marketMaintenanceQueue = new Queue('market-maintenance', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: true,
    removeOnFail: { count: 50 },
  },
});

// ─────────────────────────────────────────────────────────────────
// JOB TYPES
// ─────────────────────────────────────────────────────────────────

export interface TradeProcessedJob {
  tradeId: string;
  marketId: string;
  userId: string;
  side: string;
  price: number;
  quantity: number;
}

export interface OrderFillNotificationJob {
  userId: string;
  orderId: string;
  marketId: string;
  fillQty: number;
  fillPrice: number;
  status: string;
}

export interface CandleAggregationJob {
  resolution: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
  marketId?: string;
}

export interface MarketExpiryJob {
  marketId: string;
}

// ─────────────────────────────────────────────────────────────────
// WORKERS
// ─────────────────────────────────────────────────────────────────

let analyticsWorker: Worker | null = null;
let notificationsWorker: Worker | null = null;
let marketMaintenanceWorker: Worker | null = null;

export function startWorkers(analyticsService: AnalyticsService, orderBookService: OrderBookService): void {
  // Analytics worker: candle aggregation
  analyticsWorker = new Worker<CandleAggregationJob>(
    'analytics',
    async (job) => {
      const { resolution, marketId } = job.data;

      if (marketId) {
        logger.debug(`Aggregating candles for market ${marketId} @ ${resolution}`);
        // Single market aggregation
        await analyticsService.aggregateCandles(resolution);
      } else {
        await analyticsService.aggregateCandles(resolution);
      }
    },
    { connection, concurrency: 2 }
  );

  // Notifications worker
  notificationsWorker = new Worker<OrderFillNotificationJob>(
    'notifications',
    async (job) => {
      const { userId, orderId, marketId, fillQty, fillPrice, status } = job.data;

      // In production this would send push notifications, emails, etc.
      // For now we log and could extend to WebSocket push
      logger.debug('Sending order fill notification', {
        userId, orderId, fillQty, fillPrice, status,
      });

      // Store in-app notification (could add notifications table)
      await db('activity_feed').insert({
        user_id: userId,
        market_id: marketId,
        type: status === 'filled' ? 'order_placed' : 'order_placed',
        data: JSON.stringify({
          orderId,
          fillQty,
          fillPrice,
          status,
          message: `Your order was ${status === 'filled' ? 'fully' : 'partially'} filled`,
        }),
        is_public: false,
        created_at: new Date(),
      });
    },
    { connection, concurrency: 5 }
  );

  // Market maintenance worker: handle expired orders
  marketMaintenanceWorker = new Worker<MarketExpiryJob>(
    'market-maintenance',
    async (job) => {
      if (job.name === 'expire-orders') {
        const count = await orderBookService.expireStaleOrders();
        if (count > 0) logger.info(`Expired ${count} stale orders`);
      }

      if (job.name === 'update-unrealized-pnl') {
        await updateUnrealizedPnl();
      }
    },
    { connection, concurrency: 1 }
  );

  // Error handlers
  for (const worker of [analyticsWorker, notificationsWorker, marketMaintenanceWorker]) {
    worker.on('failed', (job, err) => {
      logger.error('Worker job failed', {
        queue: worker.name,
        jobId: job?.id,
        jobName: job?.name,
        error: err.message,
        attempts: job?.attemptsMade,
      });
    });

    worker.on('error', (err) => {
      logger.error('Worker error', { queue: worker.name, error: err.message });
    });
  }

  logger.info('✅ BullMQ workers started');
}

// ─────────────────────────────────────────────────────────────────
// RECURRING JOB SCHEDULES
// ─────────────────────────────────────────────────────────────────

export async function scheduleRecurringJobs(): Promise<void> {
  // Remove old recurring jobs first
  await analyticsQueue.obliterate({ force: false }).catch(() => {});
  await marketMaintenanceQueue.obliterate({ force: false }).catch(() => {});

  // Candle aggregation
  await analyticsQueue.add(
    'aggregate-candles-1m',
    { resolution: '1m' } satisfies CandleAggregationJob,
    { repeat: { every: 60_000 } }
  );

  await analyticsQueue.add(
    'aggregate-candles-5m',
    { resolution: '5m' } satisfies CandleAggregationJob,
    { repeat: { every: 300_000 } }
  );

  await analyticsQueue.add(
    'aggregate-candles-1h',
    { resolution: '1h' } satisfies CandleAggregationJob,
    { repeat: { every: 3_600_000 } }
  );

  // Expire stale orders every 2 minutes
  await marketMaintenanceQueue.add(
    'expire-orders',
    {},
    { repeat: { every: 120_000 } }
  );

  // Update unrealized PnL every 30 seconds
  await marketMaintenanceQueue.add(
    'update-unrealized-pnl',
    {},
    { repeat: { every: 30_000 } }
  );

  logger.info('✅ Recurring BullMQ jobs scheduled');
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

async function updateUnrealizedPnl(): Promise<void> {
  // Batch update unrealized PnL for all open positions
  // using current market prices
  await db.raw(`
    UPDATE positions p
    SET unrealized_pnl = (
      CASE
        WHEN p.side = 'yes' THEN
          (m.current_yes_price::NUMERIC - p.average_price::NUMERIC) * p.quantity::NUMERIC
        ELSE
          (m.current_no_price::NUMERIC - p.average_price::NUMERIC) * p.quantity::NUMERIC
      END
    ),
    updated_at = NOW()
    FROM markets m
    WHERE p.market_id = m.id
      AND p.quantity > 0
      AND m.status = 'active'
  `);
}

export async function enqueueTradeNotification(job: OrderFillNotificationJob): Promise<void> {
  await notificationsQueue.add('order-fill', job);
}

export async function shutdownQueues(): Promise<void> {
  await Promise.all([
    analyticsWorker?.close(),
    notificationsWorker?.close(),
    marketMaintenanceWorker?.close(),
    tradeProcessingQueue.close(),
    notificationsQueue.close(),
    analyticsQueue.close(),
    marketMaintenanceQueue.close(),
  ]);
  logger.info('BullMQ queues shut down');
}
