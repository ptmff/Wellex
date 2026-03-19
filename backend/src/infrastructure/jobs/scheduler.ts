import cron from 'node-cron';
import { db } from '../../database/connection';
import { AnalyticsService } from '../../modules/analytics/analytics.service';
import { marketCache } from '../redis/cache.service';
import { logger } from '../../common/logger';
import { activeMarketsGauge, registeredUsersGauge } from '../metrics/prometheus';

const analyticsService = new AnalyticsService();

export function startScheduledJobs(): void {
  // ── Every minute: aggregate 1m candles
  cron.schedule('* * * * *', async () => {
    try {
      await analyticsService.aggregateCandles('1m');
    } catch (err) {
      logger.error('Candle aggregation (1m) failed', { error: (err as Error).message });
    }
  });

  // ── Every 5 minutes: aggregate 5m, 15m candles
  cron.schedule('*/5 * * * *', async () => {
    try {
      await Promise.all([
        analyticsService.aggregateCandles('5m'),
        analyticsService.aggregateCandles('15m'),
      ]);
    } catch (err) {
      logger.error('Candle aggregation (5m/15m) failed', { error: (err as Error).message });
    }
  });

  // ── Every hour: aggregate 1h candles, update metrics gauges
  cron.schedule('0 * * * *', async () => {
    try {
      await analyticsService.aggregateCandles('1h');
      await analyticsService.aggregateCandles('4h');
      await updateMetricsGauges();
    } catch (err) {
      logger.error('Hourly jobs failed', { error: (err as Error).message });
    }
  });

  // ── Midnight: aggregate daily candles, reset 24h volumes
  cron.schedule('0 0 * * *', async () => {
    try {
      await analyticsService.aggregateCandles('1d');
      await reset24hVolumes();
    } catch (err) {
      logger.error('Daily jobs failed', { error: (err as Error).message });
    }
  });

  // ── Every minute: expire markets that have passed closes_at
  cron.schedule('* * * * *', async () => {
    try {
      await expireMarkets();
    } catch (err) {
      logger.error('Market expiry job failed', { error: (err as Error).message });
    }
  });

  // ── Every 5 minutes: clean up old price history (keep 30 days raw)
  cron.schedule('*/5 * * * *', async () => {
    try {
      await cleanupOldPriceHistory();
    } catch (err) {
      logger.error('Price history cleanup failed', { error: (err as Error).message });
    }
  });

  logger.info('✅ Scheduled jobs started');
}

async function expireMarkets(): Promise<void> {
  const expired = await db('markets')
    .where('status', 'active')
    .where('closes_at', '<', new Date())
    .update({ status: 'expired', updated_at: new Date() })
    .returning('id');

  if (expired.length > 0) {
    logger.info(`Expired ${expired.length} markets`, { marketIds: expired.map((m: any) => m.id) });
    for (const market of expired) {
      await marketCache.del(`market:${market.id}`);
    }
    await marketCache.delPattern('list:*');
  }
}

async function reset24hVolumes(): Promise<void> {
  await db('markets').whereIn('status', ['active', 'paused']).update({
    volume_24h: '0',
    updated_at: new Date(),
  });
  await marketCache.delPattern('*');
  logger.info('24h volumes reset');
}

async function cleanupOldPriceHistory(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
  const deleted = await db('price_history')
    .where('recorded_at', '<', cutoff)
    .delete();

  if (deleted > 0) {
    logger.debug(`Cleaned up ${deleted} old price history records`);
  }
}

async function updateMetricsGauges(): Promise<void> {
  const [activeMarkets, totalUsers] = await Promise.all([
    db('markets').where('status', 'active').count('* as count').first(),
    db('users').where('status', 'active').count('* as count').first(),
  ]);

  activeMarketsGauge.set(parseInt(String((activeMarkets as any)?.count ?? 0), 10));
  registeredUsersGauge.set(parseInt(String((totalUsers as any)?.count ?? 0), 10));
}
