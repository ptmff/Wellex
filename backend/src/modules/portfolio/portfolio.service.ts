import { z } from 'zod';
import { db, paginate } from '../../database/connection';
import { portfolioCache } from '../../infrastructure/redis/cache.service';
import { NotFoundError } from '../../common/errors';
import Decimal from 'decimal.js';

export const PortfolioHistoryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum([
    'deposit', 'withdrawal', 'trade_debit', 'trade_credit', 'fee', 'adjustment', 'refund'
  ]).optional(),
});

export class PortfolioService {
  async getPortfolio(userId: string) {
    const cacheKey = `portfolio:${userId}`;
    const cached = await portfolioCache.get(cacheKey);
    if (cached) return cached;

    const [balance, positions, recentActivity] = await Promise.all([
      db('balances').where('user_id', userId).first(),
      this.getPositions(userId),
      db('trades')
        .where('buyer_id', userId)
        .orderBy('executed_at', 'desc')
        .limit(5)
        .select('*'),
    ]);

    if (!balance) throw new NotFoundError('Portfolio', userId);

    // Calculate unrealized PnL across all positions
    let totalUnrealizedPnl = new Decimal(0);
    let totalRealizedPnl = new Decimal(0);
    let totalInvested = new Decimal(0);

    for (const pos of positions) {
      totalUnrealizedPnl = totalUnrealizedPnl.plus(pos.unrealizedPnl);
      totalRealizedPnl = totalRealizedPnl.plus(pos.realizedPnl);
      totalInvested = totalInvested.plus(pos.totalInvested);
    }

    const portfolio = {
      balance: {
        available: parseFloat(balance.available),
        reserved: parseFloat(balance.reserved),
        total: parseFloat(balance.total),
        currency: balance.currency,
      },
      pnl: {
        realized: totalRealizedPnl.toNumber(),
        unrealized: totalUnrealizedPnl.toNumber(),
        total: totalRealizedPnl.plus(totalUnrealizedPnl).toNumber(),
      },
      positions: {
        count: positions.length,
        open: positions.filter((p) => p.quantity > 0).length,
        totalInvested: totalInvested.toNumber(),
      },
      recentTrades: recentActivity.map((t) => ({
        id: t.id,
        marketId: t.market_id,
        side: t.side,
        price: parseFloat(t.price),
        quantity: parseFloat(t.quantity),
        totalValue: parseFloat(t.total_value),
        executedAt: t.executed_at,
      })),
    };

    await portfolioCache.set(cacheKey, portfolio, 10);
    return portfolio;
  }

  async getPositions(userId: string) {
    const positions = await db('positions as p')
      .join('markets as m', 'p.market_id', 'm.id')
      .where('p.user_id', userId)
      .where('p.quantity', '>', 0)
      .select(
        'p.*',
        'm.title as market_title',
        'm.status as market_status',
        'm.outcome as market_outcome',
        'm.current_yes_price',
        'm.current_no_price',
        'm.closes_at'
      )
      .orderBy('p.updated_at', 'desc');

    return positions.map((pos: any) => {
      const currentPrice = pos.side === 'yes'
        ? parseFloat(pos.current_yes_price)
        : parseFloat(pos.current_no_price);

      const quantity = parseFloat(pos.quantity);
      const avgPrice = parseFloat(pos.average_price);
      const currentValue = currentPrice * quantity;
      const costBasis = avgPrice * quantity;
      const unrealizedPnl = currentValue - costBasis;
      const unrealizedPnlPct = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

      return {
        id: pos.id,
        marketId: pos.market_id,
        marketTitle: pos.market_title,
        marketStatus: pos.market_status,
        marketOutcome: pos.market_outcome,
        side: pos.side,
        quantity,
        averagePrice: avgPrice,
        currentPrice,
        currentValue,
        totalInvested: parseFloat(pos.total_invested),
        realizedPnl: parseFloat(pos.realized_pnl),
        unrealizedPnl,
        unrealizedPnlPct,
        tradeCount: pos.trade_count,
        closesAt: pos.closes_at,
        lastTradeAt: pos.last_trade_at,
      };
    });
  }

  async getBalanceHistory(userId: string, query: z.infer<typeof PortfolioHistoryDto>) {
    const validated = PortfolioHistoryDto.parse(query);

    let q = db('balance_transactions')
      .where('user_id', userId)
      .orderBy('created_at', 'desc');

    if (validated.type) {
      q = q.where('type', validated.type);
    }

    const result = await paginate(q, { page: validated.page, limit: validated.limit });

    return {
      ...result,
      data: result.data.map((tx: any) => ({
        id: tx.id,
        type: tx.type,
        amount: parseFloat(tx.amount),
        balanceBefore: parseFloat(tx.balance_before),
        balanceAfter: parseFloat(tx.balance_after),
        description: tx.description,
        referenceType: tx.reference_type,
        referenceId: tx.reference_id,
        createdAt: tx.created_at,
      })),
    };
  }

  async getTradeHistory(
    userId: string,
    params: { page?: number; limit?: number; marketId?: string }
  ) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;

    let q = db('trades as t')
      .join('markets as m', 't.market_id', 'm.id')
      .where('t.buyer_id', userId)
      .select(
        't.*',
        'm.title as market_title',
        'm.status as market_status'
      )
      .orderBy('t.executed_at', 'desc');

    if (params.marketId) {
      q = q.where('t.market_id', params.marketId);
    }

    const result = await paginate(q, { page, limit });

    return {
      ...result,
      data: result.data.map((t: any) => ({
        id: t.id,
        marketId: t.market_id,
        marketTitle: t.market_title,
        marketStatus: t.market_status,
        side: t.side,
        tradeType: t.trade_type,
        price: parseFloat(t.price),
        quantity: parseFloat(t.quantity),
        totalValue: parseFloat(t.total_value),
        fee: parseFloat(t.fee),
        priceImpact: parseFloat(t.price_impact),
        yesPriceBefore: parseFloat(t.yes_price_before),
        yesPriceAfter: parseFloat(t.yes_price_after),
        executedAt: t.executed_at,
      })),
    };
  }

  async getPnlSummary(userId: string) {
    const cacheKey = `pnl:${userId}`;
    const cached = await portfolioCache.get(cacheKey);
    if (cached) return cached;

    const [positions, tradeStats, resolutionPayouts] = await Promise.all([
      db('positions').where('user_id', userId).select('*'),
      db('trades')
        .where('buyer_id', userId)
        .select(
          db.raw('COUNT(*) as trade_count'),
          db.raw('SUM(total_value) as total_traded'),
          db.raw('SUM(fee) as total_fees'),
          db.raw('AVG(total_value) as avg_trade_size'),
          db.raw("SUM(CASE WHEN side = 'yes' THEN total_value ELSE 0 END) as yes_volume"),
          db.raw("SUM(CASE WHEN side = 'no' THEN total_value ELSE 0 END) as no_volume")
        )
        .first(),
      db('balance_transactions')
        .where({ user_id: userId, type: 'trade_credit', reference_type: 'market_resolution' })
        .sum('amount as total')
        .first(),
    ]);

    const totalRealizedPnl = positions.reduce(
      (sum: Decimal, p: any) => sum.plus(p.realized_pnl ?? 0),
      new Decimal(0)
    );

    const summary = {
      trading: {
        tradeCount: parseInt(String((tradeStats as any)?.trade_count ?? 0), 10),
        totalTraded: parseFloat(String((tradeStats as any)?.total_traded ?? 0)),
        totalFees: parseFloat(String((tradeStats as any)?.total_fees ?? 0)),
        avgTradeSize: parseFloat(String((tradeStats as any)?.avg_trade_size ?? 0)),
        yesVolume: parseFloat(String((tradeStats as any)?.yes_volume ?? 0)),
        noVolume: parseFloat(String((tradeStats as any)?.no_volume ?? 0)),
      },
      pnl: {
        realizedFromTrades: totalRealizedPnl.toNumber(),
        resolutionPayouts: parseFloat(String((resolutionPayouts as any)?.total ?? 0)),
        totalRealized: totalRealizedPnl
          .plus(parseFloat(String((resolutionPayouts as any)?.total ?? 0)))
          .toNumber(),
      },
    };

    await portfolioCache.set(cacheKey, summary, 30);
    return summary;
  }
}
