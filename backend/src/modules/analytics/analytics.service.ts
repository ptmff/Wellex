import { z } from 'zod';
import { db } from '../../database/connection';
import { analyticsCache } from '../../infrastructure/redis/cache.service';
import { NotFoundError } from '../../common/errors';

const RESOLUTIONS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
} as const;

export type Resolution = keyof typeof RESOLUTIONS;

export const GetCandlesDto = z.object({
  resolution: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']).default('1h'),
  from: z.coerce.number().optional(),  // Unix timestamp
  to: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export interface Candle {
  time: number;         // Unix timestamp (open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
}

export class AnalyticsService {
  // ─────────────────────────────────────────────────────────────────
  // OHLCV Candles
  // ─────────────────────────────────────────────────────────────────

  async getCandles(marketId: string, query: z.infer<typeof GetCandlesDto>): Promise<Candle[]> {
    const { resolution, limit } = GetCandlesDto.parse(query);
    const intervalSeconds = RESOLUTIONS[resolution];

    const cacheKey = `candles:${marketId}:${resolution}:${limit}`;
    const cached = await analyticsCache.get<Candle[]>(cacheKey);
    if (cached) return cached;

    // Try pre-aggregated candles first
    const preAggCandles = await db('price_candles')
      .where({ market_id: marketId, resolution })
      .modify((q) => {
        if (query.from) q.where('open_time', '>=', new Date(query.from * 1000));
        if (query.to) q.where('open_time', '<=', new Date(query.to * 1000));
      })
      .orderBy('open_time', 'desc')
      .limit(limit)
      .select('*');

    if (preAggCandles.length > 0) {
      const candles = preAggCandles
        .reverse()
        .map((c: any) => ({
          time: Math.floor(new Date(c.open_time).getTime() / 1000),
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
          volume: parseFloat(c.volume),
          tradeCount: c.trade_count,
        }));

      await analyticsCache.set(cacheKey, candles, 5);
      return candles;
    }

    // Fallback: aggregate from raw price_history
    const candles = await this.aggregateCandlesFromRaw(marketId, resolution, limit, query.from, query.to);

    await analyticsCache.set(cacheKey, candles, 5);
    return candles;
  }

  private async aggregateCandlesFromRaw(
    marketId: string,
    resolution: Resolution,
    limit: number,
    from?: number,
    to?: number
  ): Promise<Candle[]> {
    const intervalSeconds = RESOLUTIONS[resolution];

    // PostgreSQL date_trunc equivalent using epoch flooring
    const result = await db.raw<{ rows: any[] }>(
      `
      SELECT
        floor(extract(epoch from recorded_at) / ?) * ? AS bucket_time,
        (array_agg(yes_price ORDER BY recorded_at ASC))[1] AS open,
        MAX(yes_price) AS high,
        MIN(yes_price) AS low,
        (array_agg(yes_price ORDER BY recorded_at DESC))[1] AS close,
        SUM(volume) AS volume,
        SUM(trade_count) AS trade_count
      FROM price_history
      WHERE market_id = ?
        ${from ? 'AND recorded_at >= to_timestamp(?)' : ''}
        ${to ? 'AND recorded_at <= to_timestamp(?)' : ''}
      GROUP BY bucket_time
      ORDER BY bucket_time DESC
      LIMIT ?
      `,
      [
        intervalSeconds, intervalSeconds,
        marketId,
        ...(from ? [from] : []),
        ...(to ? [to] : []),
        limit,
      ]
    );

    return result.rows
      .reverse()
      .map((row: any) => ({
        time: Math.floor(parseFloat(row.bucket_time)),
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        volume: parseFloat(row.volume ?? 0),
        tradeCount: parseInt(row.trade_count ?? 0, 10),
      }));
  }

  // ─────────────────────────────────────────────────────────────────
  // Price line (for simple charts)
  // ─────────────────────────────────────────────────────────────────

  async getPriceLine(
    marketId: string,
    from?: Date,
    to?: Date,
    points = 200
  ): Promise<Array<{ time: number; yesPrice: number; noPrice: number }>> {
    const cacheKey = `priceline:${marketId}:${from?.getTime()}:${to?.getTime()}:${points}`;
    const cached = await analyticsCache.get<any[]>(cacheKey);
    if (cached) return cached;

    // Build a filtered query once, and only apply ordering to the final
    // non-aggregate selects. Postgres rejects `COUNT(*) ... ORDER BY ...`.
    const baseQuery = db('price_history').where('market_id', marketId);
    if (from) baseQuery.where('recorded_at', '>=', from);
    if (to) baseQuery.where('recorded_at', '<=', to);

    // Downsample if needed.
    const total = await baseQuery.clone().count({ count: '*' }).first();
    const totalCount = parseInt(String((total as any)?.count ?? 0), 10);

    let rows: any[];
    if (totalCount > points) {
      // Use every Nth row for downsampling
      const nth = Math.ceil(totalCount / points);
      rows = await db.raw(
        `
        SELECT yes_price, no_price, recorded_at
        FROM (
          SELECT yes_price, no_price, recorded_at,
                 row_number() OVER (ORDER BY recorded_at) AS rn
          FROM price_history
          WHERE market_id = ?
            ${from ? 'AND recorded_at >= ?' : ''}
            ${to ? 'AND recorded_at <= ?' : ''}
        ) t
        WHERE rn % ? = 0
        ORDER BY recorded_at
        `,
        [marketId, ...(from ? [from] : []), ...(to ? [to] : []), nth]
      ).then((r) => r.rows);
    } else {
      rows = await baseQuery
        .clone()
        .orderBy('recorded_at', 'asc')
        .select('yes_price', 'no_price', 'recorded_at');
    }

    const result = rows.map((row: any) => ({
      time: Math.floor(new Date(row.recorded_at).getTime() / 1000),
      yesPrice: parseFloat(row.yes_price),
      noPrice: parseFloat(row.no_price),
    }));

    await analyticsCache.set(cacheKey, result, 10);
    return result;
  }

  // ─────────────────────────────────────────────────────────────────
  // Volume metrics
  // ─────────────────────────────────────────────────────────────────

  async getVolumeHistory(
    marketId: string,
    resolution: Resolution = '1d',
    limit = 30
  ): Promise<Array<{ time: number; volume: number; tradeCount: number }>> {
    const intervalSeconds = RESOLUTIONS[resolution];

    const result = await db.raw<{ rows: any[] }>(
      `
      SELECT
        floor(extract(epoch from executed_at) / ?) * ? AS bucket_time,
        SUM(total_value) AS volume,
        COUNT(*) AS trade_count
      FROM trades
      WHERE market_id = ?
      GROUP BY bucket_time
      ORDER BY bucket_time DESC
      LIMIT ?
      `,
      [intervalSeconds, intervalSeconds, marketId, limit]
    );

    return result.rows
      .reverse()
      .map((row: any) => ({
        time: Math.floor(parseFloat(row.bucket_time)),
        volume: parseFloat(row.volume ?? 0),
        tradeCount: parseInt(row.trade_count ?? 0, 10),
      }));
  }

  // ─────────────────────────────────────────────────────────────────
  // Platform-wide metrics
  // ─────────────────────────────────────────────────────────────────

  async getPlatformMetrics() {
    const cacheKey = 'platform:metrics';
    const cached = await analyticsCache.get(cacheKey);
    if (cached) return cached;

    const [
      totalMarkets,
      activeMarkets,
      totalTrades,
      totalVolume,
      activeUsers24h,
      totalUsers,
    ] = await Promise.all([
      db('markets').count('* as count').first(),
      db('markets').where('status', 'active').count('* as count').first(),
      db('trades').count('* as count').first(),
      db('trades').sum('total_value as sum').first(),
      db('trades')
        .where('executed_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
        .countDistinct('buyer_id as count')
        .first(),
      db('users').where('status', 'active').count('* as count').first(),
    ]);

    const metrics = {
      markets: {
        total: parseInt(String((totalMarkets as any)?.count ?? 0), 10),
        active: parseInt(String((activeMarkets as any)?.count ?? 0), 10),
      },
      trading: {
        totalTrades: parseInt(String((totalTrades as any)?.count ?? 0), 10),
        totalVolume: parseFloat(String((totalVolume as any)?.sum ?? 0)),
      },
      users: {
        total: parseInt(String((totalUsers as any)?.count ?? 0), 10),
        active24h: parseInt(String((activeUsers24h as any)?.count ?? 0), 10),
      },
      timestamp: new Date().toISOString(),
    };

    await analyticsCache.set(cacheKey, metrics, 60);
    return metrics;
  }

  // ─────────────────────────────────────────────────────────────────
  // Candle aggregation job (run periodically)
  // ─────────────────────────────────────────────────────────────────

  async aggregateCandles(resolution: Resolution): Promise<void> {
    const intervalSeconds = RESOLUTIONS[resolution];
    const activeMarkets = await db('markets')
      .whereIn('status', ['active', 'paused'])
      .select('id');

    for (const market of activeMarkets) {
      await this.aggregateCandlesForMarket(market.id, resolution, intervalSeconds);
    }
  }

  private async aggregateCandlesForMarket(
    marketId: string,
    resolution: Resolution,
    intervalSeconds: number
  ): Promise<void> {
    // Find the latest aggregated candle
    const lastCandle = await db('price_candles')
      .where({ market_id: marketId, resolution })
      .orderBy('open_time', 'desc')
      .first();

    const fromTime = lastCandle
      ? new Date(lastCandle.close_time)
      : new Date(0);

    const result = await db.raw<{ rows: any[] }>(
      `
      SELECT
        to_timestamp(floor(extract(epoch from recorded_at) / ?) * ?) AS open_time,
        to_timestamp(floor(extract(epoch from recorded_at) / ?) * ? + ?) AS close_time,
        (array_agg(yes_price ORDER BY recorded_at ASC))[1] AS open,
        MAX(yes_price) AS high,
        MIN(yes_price) AS low,
        (array_agg(yes_price ORDER BY recorded_at DESC))[1] AS close,
        SUM(volume) AS volume,
        SUM(trade_count) AS trade_count
      FROM price_history
      WHERE market_id = ?
        AND recorded_at > ?
      GROUP BY open_time, close_time
      ORDER BY open_time
      `,
      [
        intervalSeconds, intervalSeconds,
        intervalSeconds, intervalSeconds, intervalSeconds,
        marketId, fromTime,
      ]
    );

    if (result.rows.length === 0) return;

    // Upsert candles
    await db('price_candles')
      .insert(
        result.rows.map((row: any) => ({
          market_id: marketId,
          resolution,
          open_time: row.open_time,
          close_time: row.close_time,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume ?? 0,
          trade_count: row.trade_count ?? 0,
        }))
      )
      .onConflict(['market_id', 'resolution', 'open_time'])
      .merge(['high', 'low', 'close', 'volume', 'trade_count']);
  }
}
