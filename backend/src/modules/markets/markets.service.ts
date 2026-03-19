import { z } from 'zod';
import { db, paginate, PaginationParams } from '../../database/connection';
import { marketCache } from '../../infrastructure/redis/cache.service';
import { AppError, ErrorCode, NotFoundError } from '../../common/errors';
import { logger } from '../../common/logger';
import { config } from '../../config';
import Decimal from 'decimal.js';

// ─────────────────────────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────────────────────────

export const CreateMarketDto = z.object({
  title: z.string().min(10).max(500),
  description: z.string().min(20).max(5000),
  resolutionCriteria: z.string().min(20).max(2000),
  categoryId: z.string().uuid().optional(),
  closesAt: z
    .string()
    .datetime()
    .refine((d) => new Date(d) > new Date(Date.now() + 60 * 60 * 1000), {
      message: 'Market must close at least 1 hour from now',
    }),
  initialLiquidity: z.number().min(10).max(100000).default(100),
  imageUrl: z.string().url().optional(),
  tags: z.array(z.string().max(50)).max(10).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export const UpdateMarketDto = z.object({
  title: z.string().min(10).max(500).optional(),
  description: z.string().min(20).max(5000).optional(),
  resolutionCriteria: z.string().min(20).max(2000).optional(),
  imageUrl: z.string().url().optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

export const ListMarketsDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'active', 'paused', 'resolved', 'cancelled', 'expired']).optional(),
  categoryId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  sortBy: z
    .enum(['created_at', 'closes_at', 'volume_24h', 'volume_total', 'trade_count'])
    .default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  featured: z.coerce.boolean().optional(),
  tag: z.string().optional(),
});

export type CreateMarketInput = z.infer<typeof CreateMarketDto>;

// ─────────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────────

export class MarketsService {
  async create(userId: string, input: CreateMarketInput) {
    const validated = CreateMarketDto.parse(input);

    // Calculate LMSR b parameter based on initial liquidity
    // b = initialLiquidity / ln(2) gives 50/50 initial price
    const b = new Decimal(validated.initialLiquidity).div(Math.LN2);

    const market = await db.transaction(async (trx) => {
      // Deduct initial liquidity from creator's balance
      const balance = await trx('balances')
        .where('user_id', userId)
        .forUpdate()
        .first();

      if (!balance || new Decimal(balance.available).lt(validated.initialLiquidity)) {
        throw new AppError(
          ErrorCode.INSUFFICIENT_BALANCE,
          `Insufficient balance for initial liquidity (need ${validated.initialLiquidity})`,
          400
        );
      }

      await trx('balances')
        .where('user_id', userId)
        .update({
          available: trx.raw('available - ?', [validated.initialLiquidity]),
          total: trx.raw('total - ?', [validated.initialLiquidity]),
          updated_at: new Date(),
        });

      const [newMarket] = await trx('markets')
        .insert({
          creator_id: userId,
          category_id: validated.categoryId ?? null,
          title: validated.title,
          description: validated.description,
          resolution_criteria: validated.resolutionCriteria,
          image_url: validated.imageUrl ?? null,
          status: 'active',
          initial_liquidity: validated.initialLiquidity,
          liquidity_b: b.toFixed(8),
          yes_shares: '0',
          no_shares: '0',
          current_yes_price: '0.5',
          current_no_price: '0.5',
          liquidity_total: validated.initialLiquidity,
          closes_at: new Date(validated.closesAt),
          tags: JSON.stringify(validated.tags),
          metadata: JSON.stringify(validated.metadata),
        })
        .returning('*');

      // Record liquidity event
      await trx('liquidity_events').insert({
        market_id: newMarket.id,
        user_id: userId,
        type: 'initial',
        amount: validated.initialLiquidity,
        total_liquidity_before: 0,
        total_liquidity_after: validated.initialLiquidity,
      });

      // Initial price history snapshot
      await trx('price_history').insert({
        market_id: newMarket.id,
        yes_price: '0.5',
        no_price: '0.5',
        volume: '0',
        trade_count: 0,
      });

      return newMarket;
    });

    logger.info('Market created', { marketId: market.id, userId, title: market.title });

    return this.formatMarket(market);
  }

  async findById(marketId: string) {
    const cacheKey = `market:${marketId}`;
    const cached = await marketCache.get(cacheKey);
    if (cached) return cached;

    const market = await db('markets as m')
      .leftJoin('market_categories as c', 'm.category_id', 'c.id')
      .leftJoin('users as u', 'm.creator_id', 'u.id')
      .select(
        'm.*',
        'c.name as category_name',
        'c.slug as category_slug',
        'u.username as creator_username',
        'u.display_name as creator_display_name'
      )
      .where('m.id', marketId)
      .first();

    if (!market) throw new NotFoundError('Market', marketId);

    const formatted = this.formatMarket(market);
    await marketCache.set(cacheKey, formatted, config.CACHE_MARKET_TTL);

    return formatted;
  }

  async list(query: z.infer<typeof ListMarketsDto>) {
    const validated = ListMarketsDto.parse(query);
    const cacheKey = `list:${JSON.stringify(validated)}`;

    const cached = await marketCache.get(cacheKey);
    if (cached) return cached;

    let queryBuilder = db('markets as m')
      .leftJoin('market_categories as c', 'm.category_id', 'c.id')
      .leftJoin('users as u', 'm.creator_id', 'u.id')
      .select(
        'm.id', 'm.title', 'm.description', 'm.status', 'm.outcome',
        'm.current_yes_price', 'm.current_no_price',
        'm.volume_24h', 'm.volume_total', 'm.trade_count',
        'm.closes_at', 'm.created_at', 'm.is_featured', 'm.tags',
        'm.image_url',
        'c.name as category_name', 'c.slug as category_slug',
        'u.username as creator_username'
      );

    if (validated.status) {
      queryBuilder = queryBuilder.where('m.status', validated.status);
    } else {
      queryBuilder = queryBuilder.whereIn('m.status', ['active', 'resolved']);
    }

    if (validated.categoryId) {
      queryBuilder = queryBuilder.where('m.category_id', validated.categoryId);
    }

    if (validated.featured !== undefined) {
      queryBuilder = queryBuilder.where('m.is_featured', validated.featured);
    }

    if (validated.search) {
      queryBuilder = queryBuilder.whereRaw(
        `to_tsvector('english', m.title || ' ' || m.description) @@ plainto_tsquery('english', ?)`,
        [validated.search]
      );
    }

    if (validated.tag) {
      queryBuilder = queryBuilder.whereRaw('m.tags @> ?::jsonb', [
        JSON.stringify([validated.tag]),
      ]);
    }

    queryBuilder = queryBuilder.orderBy(`m.${validated.sortBy}`, validated.sortOrder);

    const result = await paginate(queryBuilder, {
      page: validated.page,
      limit: validated.limit,
    });

    const formatted = {
      ...result,
      data: result.data.map(this.formatMarket),
    };

    await marketCache.set(cacheKey, formatted, 15); // 15s cache for lists
    return formatted;
  }

  async update(marketId: string, userId: string, input: z.infer<typeof UpdateMarketDto>) {
    const market = await db('markets').where('id', marketId).first();

    if (!market) throw new NotFoundError('Market', marketId);
    if (market.creator_id !== userId) {
      const user = await db('users').where('id', userId).select('role').first();
      if (user?.role === 'user') {
        throw new AppError(ErrorCode.FORBIDDEN, 'Not authorized to update this market', 403);
      }
    }

    if (!['active', 'pending', 'paused'].includes(market.status)) {
      throw new AppError(
        ErrorCode.INVALID_MARKET_STATUS,
        'Cannot update market in current status',
        400
      );
    }

    const validated = UpdateMarketDto.parse(input);
    const updateData: Record<string, any> = { updated_at: new Date() };

    if (validated.title) updateData.title = validated.title;
    if (validated.description) updateData.description = validated.description;
    if (validated.resolutionCriteria) updateData.resolution_criteria = validated.resolutionCriteria;
    if (validated.imageUrl !== undefined) updateData.image_url = validated.imageUrl;
    if (validated.tags) updateData.tags = JSON.stringify(validated.tags);

    const [updated] = await db('markets').where('id', marketId).update(updateData).returning('*');

    await marketCache.del(`market:${marketId}`);
    await marketCache.delPattern('list:*');

    return this.formatMarket(updated);
  }

  async updateStatus(
    marketId: string,
    status: 'active' | 'paused' | 'cancelled',
    userId: string
  ) {
    const market = await db('markets').where('id', marketId).first();
    if (!market) throw new NotFoundError('Market', marketId);

    const validTransitions: Record<string, string[]> = {
      pending: ['active', 'cancelled'],
      active: ['paused', 'cancelled'],
      paused: ['active', 'cancelled'],
    };

    if (!validTransitions[market.status]?.includes(status)) {
      throw new AppError(
        ErrorCode.INVALID_MARKET_STATUS,
        `Cannot transition from ${market.status} to ${status}`,
        400
      );
    }

    const [updated] = await db('markets')
      .where('id', marketId)
      .update({ status, updated_at: new Date() })
      .returning('*');

    await marketCache.del(`market:${marketId}`);

    return this.formatMarket(updated);
  }

  async getStats(marketId: string) {
    const [market, recentTrades, uniqueTraders] = await Promise.all([
      db('markets').where('id', marketId).first(),
      db('trades')
        .where('market_id', marketId)
        .orderBy('executed_at', 'desc')
        .limit(10),
      db('trades')
        .where('market_id', marketId)
        .countDistinct('buyer_id as count')
        .first(),
    ]);

    if (!market) throw new NotFoundError('Market', marketId);

    return {
      marketId,
      volume24h: parseFloat(market.volume_24h),
      volumeTotal: parseFloat(market.volume_total),
      tradeCount: market.trade_count,
      uniqueTraders: parseInt(String((uniqueTraders as any)?.count ?? 0), 10),
      currentYesPrice: parseFloat(market.current_yes_price),
      currentNoPrice: parseFloat(market.current_no_price),
      liquidityTotal: parseFloat(market.liquidity_total),
      recentTrades: recentTrades.map((t) => ({
        id: t.id,
        side: t.side,
        price: parseFloat(t.price),
        quantity: parseFloat(t.quantity),
        totalValue: parseFloat(t.total_value),
        executedAt: t.executed_at,
      })),
    };
  }

  private formatMarket(market: any) {
    return {
      id: market.id,
      title: market.title,
      description: market.description,
      resolutionCriteria: market.resolution_criteria,
      imageUrl: market.image_url,
      status: market.status,
      outcome: market.outcome,
      category: market.category_name
        ? { id: market.category_id, name: market.category_name, slug: market.category_slug }
        : null,
      creator: market.creator_username
        ? { username: market.creator_username, displayName: market.creator_display_name }
        : null,
      prices: {
        yes: parseFloat(market.current_yes_price ?? 0.5),
        no: parseFloat(market.current_no_price ?? 0.5),
      },
      stats: {
        volume24h: parseFloat(market.volume_24h ?? 0),
        volumeTotal: parseFloat(market.volume_total ?? 0),
        tradeCount: market.trade_count ?? 0,
        liquidityTotal: parseFloat(market.liquidity_total ?? 0),
      },
      closesAt: market.closes_at,
      resolvedAt: market.resolved_at,
      resolutionNote: market.resolution_note,
      isFeatured: market.is_featured,
      tags: typeof market.tags === 'string' ? JSON.parse(market.tags) : (market.tags ?? []),
      createdAt: market.created_at,
      updatedAt: market.updated_at,
    };
  }
}
