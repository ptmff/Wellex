/**
 * Order Book Service
 *
 * Manages limit orders and matches them against the LMSR AMM.
 * Strategy: hybrid — limit orders fill against each other first,
 * remainder fills against LMSR pool.
 *
 * Order lifecycle:
 *   pending → open → partially_filled / filled
 *                  → cancelled / expired
 */

import { z } from 'zod';
import Decimal from 'decimal.js';
import { db, withTransaction, paginate } from '../../database/connection';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { AppError, ErrorCode, NotFoundError, InsufficientBalanceError } from '../../common/errors';
import { logger } from '../../common/logger';
import { WebSocketService } from '../../infrastructure/websocket/ws.service';
import { ActivityService } from '../activity/activity.service';

const orderBookCache = new CacheService('orderbook');

// ─────────────────────────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────────────────────────

export const PlaceLimitOrderDto = z.object({
  side: z.enum(['yes', 'no']),
  action: z.enum(['buy', 'sell']),
  price: z.number().gt(0).lt(1),          // Probability price 0–1
  quantity: z.number().positive(),         // Shares
  expiresAt: z.string().datetime().optional(),
});

export const GetOrderBookDto = z.object({
  depth: z.coerce.number().int().min(1).max(50).default(10),
});

export const ListOrdersDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'open', 'partially_filled', 'filled', 'cancelled', 'expired']).optional(),
  marketId: z.string().uuid().optional(),
  side: z.enum(['yes', 'no']).optional(),
});

export type PlaceLimitOrderInput = z.infer<typeof PlaceLimitOrderDto>;

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

interface OrderBookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

interface OrderBookSnapshot {
  marketId: string;
  yesAsks: OrderBookLevel[]; // Sell YES orders (ask)
  yesBids: OrderBookLevel[]; // Buy YES orders (bid)
  noAsks: OrderBookLevel[];
  noBids: OrderBookLevel[];
  spread: { yes: number; no: number };
  midPrice: { yes: number; no: number };
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────────

export class OrderBookService {
  private readonly FEE_RATE = new Decimal('0.005'); // 0.5%

  constructor(
    private readonly wsService: WebSocketService,
    private readonly activityService: ActivityService
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // PLACE ORDER
  // ─────────────────────────────────────────────────────────────────

  async placeOrder(userId: string, marketId: string, input: PlaceLimitOrderInput) {
    const validated = PlaceLimitOrderDto.parse(input);

    return withTransaction(async (trx) => {
      // Validate market
      const market = await trx('markets')
        .where('id', marketId)
        .forUpdate()
        .first();

      if (!market) throw new NotFoundError('Market', marketId);
      if (market.status !== 'active') {
        throw new AppError(ErrorCode.MARKET_INACTIVE, `Market is ${market.status}`, 400);
      }
      if (new Date(market.closes_at) <= new Date()) {
        throw new AppError(ErrorCode.MARKET_CLOSED, 'Market has closed', 400);
      }

      const price = new Decimal(validated.price);
      const quantity = new Decimal(validated.quantity);

      // Calculate order cost / collateral needed
      let reserveAmount: Decimal;

      if (validated.action === 'buy') {
        // Buying: reserve price * quantity + fee
        const cost = price.mul(quantity);
        const fee = cost.mul(this.FEE_RATE);
        reserveAmount = cost.plus(fee);
      } else {
        // Selling: reserve shares (need to own them)
        const position = await trx('positions')
          .where({ user_id: userId, market_id: marketId, side: validated.side })
          .first();

        const available = new Decimal(position?.quantity ?? 0);

        // Check existing sell orders
        const existingSellOrders = await trx('orders')
          .where({ user_id: userId, market_id: marketId, side: validated.side, action: 'sell' })
          .whereIn('status', ['open', 'partially_filled'])
          .sum('remaining_quantity as total')
          .first();

        const alreadyReserved = new Decimal((existingSellOrders as any)?.total ?? 0);
        const availableToSell = available.minus(alreadyReserved);

        if (availableToSell.lt(quantity)) {
          throw new AppError(
            ErrorCode.INSUFFICIENT_SHARES,
            `Insufficient shares: available ${availableToSell.toFixed(4)}, need ${quantity.toFixed(4)}`,
            400
          );
        }
        reserveAmount = new Decimal(0); // Shares are the collateral, no USD needed
      }

      // Reserve balance for buy orders
      if (validated.action === 'buy') {
        const balance = await trx('balances')
          .where('user_id', userId)
          .forUpdate()
          .first();

        if (!balance) throw new NotFoundError('Balance');

        const available = new Decimal(balance.available);
        if (available.lt(reserveAmount)) {
          throw new InsufficientBalanceError(available.toNumber(), reserveAmount.toNumber());
        }

        await trx('balances')
          .where('user_id', userId)
          .update({
            available: trx.raw('available - ?', [reserveAmount.toFixed(8)]),
            reserved: trx.raw('reserved + ?', [reserveAmount.toFixed(8)]),
            updated_at: new Date(),
          });
      }

      // Create the order
      const [order] = await trx('orders')
        .insert({
          user_id: userId,
          market_id: marketId,
          side: validated.side,
          type: 'limit',
          action: validated.action,
          status: 'open',
          price: price.toFixed(8),
          quantity: quantity.toFixed(8),
          filled_quantity: '0',
          remaining_quantity: quantity.toFixed(8),
          total_cost: reserveAmount.toFixed(8),
          expires_at: validated.expiresAt ? new Date(validated.expiresAt) : null,
          metadata: '{}',
        })
        .returning('*');

      // Attempt immediate matching
      await this.matchOrders(trx, marketId, validated.side, validated.action);

      // Invalidate order book cache
      await orderBookCache.del(`book:${marketId}`);

      // Broadcast to subscribers
      setImmediate(async () => {
        try {
          const book = await this.getOrderBook(marketId);
          await this.wsService.broadcastToMarket(marketId, 'price_update', {
            type: 'orderbook_update',
            marketId,
            orderBook: book,
          });

          await this.activityService.record({
            userId,
            marketId,
            type: 'order_placed',
            data: {
              orderId: order.id,
              side: validated.side,
              action: validated.action,
              price: price.toNumber(),
              quantity: quantity.toNumber(),
            },
          });
        } catch (err) {
          logger.warn('Order placement side effects failed', { orderId: order.id });
        }
      });

      return this.formatOrder(order);
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // ORDER MATCHING ENGINE
  // ─────────────────────────────────────────────────────────────────

  private async matchOrders(
    trx: any,
    marketId: string,
    side: 'yes' | 'no',
    triggerAction: 'buy' | 'sell'
  ): Promise<void> {
    // Match buy orders against sell orders at crossing prices
    // Bids sorted DESC by price (best bid first)
    // Asks sorted ASC by price (best ask first)

    const openBuys = await trx('orders')
      .where({ market_id: marketId, side, action: 'buy', type: 'limit' })
      .whereIn('status', ['open', 'partially_filled'])
      .orderBy('price', 'desc')  // Highest buyer first
      .orderBy('created_at', 'asc') // FIFO for same price
      .select('*');

    const openSells = await trx('orders')
      .where({ market_id: marketId, side, action: 'sell', type: 'limit' })
      .whereIn('status', ['open', 'partially_filled'])
      .orderBy('price', 'asc')  // Lowest seller first
      .orderBy('created_at', 'asc')
      .select('*');

    let buyIdx = 0;
    let sellIdx = 0;

    while (buyIdx < openBuys.length && sellIdx < openSells.length) {
      const buy = openBuys[buyIdx];
      const sell = openSells[sellIdx];

      const buyPrice = new Decimal(buy.price);
      const sellPrice = new Decimal(sell.price);

      // No match possible
      if (buyPrice.lt(sellPrice)) break;

      // Match at midpoint or maker price (use sell price — maker is seller here)
      const matchPrice = sellPrice;

      const buyRemaining = new Decimal(buy.remaining_quantity);
      const sellRemaining = new Decimal(sell.remaining_quantity);
      const fillQty = Decimal.min(buyRemaining, sellRemaining);

      await this.executeFill(trx, marketId, buy, sell, fillQty, matchPrice);

      // Update local state for next iteration
      buy.remaining_quantity = buyRemaining.minus(fillQty).toFixed(8);
      sell.remaining_quantity = sellRemaining.minus(fillQty).toFixed(8);
      buy.filled_quantity = new Decimal(buy.filled_quantity).plus(fillQty).toFixed(8);
      sell.filled_quantity = new Decimal(sell.filled_quantity).plus(fillQty).toFixed(8);

      if (new Decimal(buy.remaining_quantity).lte(0.000001)) buyIdx++;
      if (new Decimal(sell.remaining_quantity).lte(0.000001)) sellIdx++;
    }
  }

  private async executeFill(
    trx: any,
    marketId: string,
    buyOrder: any,
    sellOrder: any,
    fillQty: Decimal,
    matchPrice: Decimal
  ): Promise<void> {
    const totalValue = fillQty.mul(matchPrice);
    const buyerFee = totalValue.mul(this.FEE_RATE);
    const sellerFee = totalValue.mul(this.FEE_RATE);
    const sellerReceives = totalValue.minus(sellerFee);

    // Create trade record
    const [trade] = await trx('trades')
      .insert({
        market_id: marketId,
        buyer_id: buyOrder.user_id,
        seller_id: sellOrder.user_id,
        buyer_order_id: buyOrder.id,
        seller_order_id: sellOrder.id,
        side: buyOrder.side,
        trade_type: 'order_book',
        price: matchPrice.toFixed(8),
        quantity: fillQty.toFixed(8),
        total_value: totalValue.toFixed(8),
        fee: buyerFee.plus(sellerFee).toFixed(8),
        yes_price_before: matchPrice.toFixed(8),
        yes_price_after: matchPrice.toFixed(8),
        price_impact: '0',
        executed_at: new Date(),
        metadata: JSON.stringify({ orderBook: true }),
      })
      .returning('*');

    // Update buyer order
    const buyFilled = new Decimal(buyOrder.filled_quantity).plus(fillQty);
    const buyRemaining = new Decimal(buyOrder.remaining_quantity).minus(fillQty);
    const buyStatus = buyRemaining.lte(0.000001) ? 'filled' : 'partially_filled';

    await trx('orders')
      .where('id', buyOrder.id)
      .update({
        filled_quantity: buyFilled.toFixed(8),
        remaining_quantity: Decimal.max(0, buyRemaining).toFixed(8),
        status: buyStatus,
        average_fill_price: buyFilled.gt(0)
          ? new Decimal(buyOrder.total_cost ?? 0).div(buyFilled).toFixed(8)
          : matchPrice.toFixed(8),
        updated_at: new Date(),
      });

    // Update seller order
    const sellFilled = new Decimal(sellOrder.filled_quantity).plus(fillQty);
    const sellRemaining = new Decimal(sellOrder.remaining_quantity).minus(fillQty);
    const sellStatus = sellRemaining.lte(0.000001) ? 'filled' : 'partially_filled';

    await trx('orders')
      .where('id', sellOrder.id)
      .update({
        filled_quantity: sellFilled.toFixed(8),
        remaining_quantity: Decimal.max(0, sellRemaining).toFixed(8),
        status: sellStatus,
        average_fill_price: matchPrice.toFixed(8),
        updated_at: new Date(),
      });

    // ── Transfer funds: buyer pays → seller receives
    // Buyer already had funds reserved; release excess if partially filled
    const buyerCostForFill = fillQty.mul(matchPrice).plus(buyerFee);
    const buyerReservedForFill = fillQty.mul(new Decimal(buyOrder.price));
    const buyerRefund = buyerReservedForFill.minus(buyerCostForFill);

    // Credit buyer's position
    await this.upsertPositionFill(trx, buyOrder.user_id, marketId, buyOrder.side, 'buy', fillQty, matchPrice);

    // Debit buyer balance (refund overpaid if limit price > fill price)
    if (buyerRefund.gt(0)) {
      await trx('balances')
        .where('user_id', buyOrder.user_id)
        .update({
          available: trx.raw('available + ?', [buyerRefund.toFixed(8)]),
          reserved: trx.raw('reserved - ?', [buyerReservedForFill.toFixed(8)]),
          updated_at: new Date(),
        });
    } else {
      await trx('balances')
        .where('user_id', buyOrder.user_id)
        .update({
          reserved: trx.raw('reserved - ?', [buyerReservedForFill.toFixed(8)]),
          updated_at: new Date(),
        });
    }

    // Log buyer balance transaction
    const buyerBalance = await trx('balances').where('user_id', buyOrder.user_id).first();
    await trx('balance_transactions').insert({
      user_id: buyOrder.user_id,
      type: 'trade_debit',
      amount: buyerCostForFill.toFixed(8),
      balance_before: new Decimal(buyerBalance.available).plus(buyerCostForFill).toFixed(8),
      balance_after: buyerBalance.available,
      reference_type: 'trade',
      reference_id: trade.id,
      description: `Limit order fill: bought ${fillQty.toFixed(4)} ${buyOrder.side.toUpperCase()} @ ${matchPrice.toFixed(4)}`,
    });

    // Credit seller
    await this.upsertPositionFill(trx, sellOrder.user_id, marketId, sellOrder.side, 'sell', fillQty, matchPrice);

    const sellerBalance = await trx('balances')
      .where('user_id', sellOrder.user_id)
      .forUpdate()
      .first();

    await trx('balances')
      .where('user_id', sellOrder.user_id)
      .update({
        available: trx.raw('available + ?', [sellerReceives.toFixed(8)]),
        total: trx.raw('total + ?', [sellerReceives.toFixed(8)]),
        updated_at: new Date(),
      });

    await trx('balance_transactions').insert({
      user_id: sellOrder.user_id,
      type: 'trade_credit',
      amount: sellerReceives.toFixed(8),
      balance_before: sellerBalance.available,
      balance_after: new Decimal(sellerBalance.available).plus(sellerReceives).toFixed(8),
      reference_type: 'trade',
      reference_id: trade.id,
      description: `Limit order fill: sold ${fillQty.toFixed(4)} ${sellOrder.side.toUpperCase()} @ ${matchPrice.toFixed(4)}`,
    });

    // Update market stats
    await trx('markets')
      .where('id', marketId)
      .update({
        volume_24h: trx.raw('volume_24h + ?', [totalValue.toFixed(8)]),
        volume_total: trx.raw('volume_total + ?', [totalValue.toFixed(8)]),
        trade_count: trx.raw('trade_count + 1'),
        updated_at: new Date(),
      });

    logger.debug('Order book fill executed', {
      tradeId: trade.id,
      buyOrderId: buyOrder.id,
      sellOrderId: sellOrder.id,
      qty: fillQty.toFixed(4),
      price: matchPrice.toFixed(4),
    });
  }

  private async upsertPositionFill(
    trx: any,
    userId: string,
    marketId: string,
    side: 'yes' | 'no',
    action: 'buy' | 'sell',
    qty: Decimal,
    price: Decimal
  ): Promise<void> {
    const existing = await trx('positions')
      .where({ user_id: userId, market_id: marketId, side })
      .first();

    if (action === 'buy') {
      if (!existing) {
        await trx('positions').insert({
          user_id: userId,
          market_id: marketId,
          side,
          quantity: qty.toFixed(8),
          average_price: price.toFixed(8),
          total_invested: qty.mul(price).toFixed(8),
          trade_count: 1,
          last_trade_at: new Date(),
        });
      } else {
        const newQty = new Decimal(existing.quantity).plus(qty);
        const newInvested = new Decimal(existing.total_invested).plus(qty.mul(price));
        await trx('positions')
          .where({ user_id: userId, market_id: marketId, side })
          .update({
            quantity: newQty.toFixed(8),
            average_price: newInvested.div(newQty).toFixed(8),
            total_invested: newInvested.toFixed(8),
            trade_count: trx.raw('trade_count + 1'),
            last_trade_at: new Date(),
            updated_at: new Date(),
          });
      }
    } else {
      // Sell: reduce position, calculate realized PnL
      if (existing) {
        const currentQty = new Decimal(existing.quantity);
        const avgPrice = new Decimal(existing.average_price);
        const newQty = currentQty.minus(qty);
        const realizedPnl = price.minus(avgPrice).mul(qty);

        await trx('positions')
          .where({ user_id: userId, market_id: marketId, side })
          .update({
            quantity: Decimal.max(0, newQty).toFixed(8),
            total_invested: Decimal.max(0, avgPrice.mul(Decimal.max(0, newQty))).toFixed(8),
            realized_pnl: trx.raw('realized_pnl + ?', [realizedPnl.toFixed(8)]),
            trade_count: trx.raw('trade_count + 1'),
            last_trade_at: new Date(),
            updated_at: new Date(),
          });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // CANCEL ORDER
  // ─────────────────────────────────────────────────────────────────

  async cancelOrder(userId: string, orderId: string): Promise<void> {
    return withTransaction(async (trx) => {
      const order = await trx('orders')
        .where('id', orderId)
        .forUpdate()
        .first();

      if (!order) throw new NotFoundError('Order', orderId);
      if (order.user_id !== userId) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Not authorized to cancel this order', 403);
      }

      if (order.status === 'cancelled') {
        throw new AppError(ErrorCode.ORDER_ALREADY_CANCELLED, 'Order already cancelled', 400);
      }
      if (order.status === 'filled') {
        throw new AppError(ErrorCode.ORDER_ALREADY_FILLED, 'Cannot cancel filled order', 400);
      }
      if (!['open', 'partially_filled', 'pending'].includes(order.status)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `Cannot cancel order in status: ${order.status}`, 400);
      }

      // Refund reserved balance
      if (order.action === 'buy') {
        const remainingCost = new Decimal(order.remaining_quantity).mul(new Decimal(order.price));
        const feeOnRemaining = remainingCost.mul(this.FEE_RATE);
        const refundAmount = remainingCost.plus(feeOnRemaining);

        if (refundAmount.gt(0)) {
          const balance = await trx('balances').where('user_id', userId).first();

          await trx('balances')
            .where('user_id', userId)
            .update({
              available: trx.raw('available + ?', [refundAmount.toFixed(8)]),
              reserved: trx.raw('reserved - ?', [refundAmount.toFixed(8)]),
              updated_at: new Date(),
            });

          await trx('balance_transactions').insert({
            user_id: userId,
            type: 'refund',
            amount: refundAmount.toFixed(8),
            balance_before: balance.available,
            balance_after: new Decimal(balance.available).plus(refundAmount).toFixed(8),
            reference_type: 'order',
            reference_id: orderId,
            description: 'Order cancelled — reserved funds released',
          });
        }
      }

      await trx('orders')
        .where('id', orderId)
        .update({
          status: 'cancelled',
          cancel_reason: 'User cancelled',
          updated_at: new Date(),
        });

      await orderBookCache.del(`book:${order.market_id}`);

      logger.info('Order cancelled', { orderId, userId, marketId: order.market_id });
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // EXPIRE STALE ORDERS (run via cron)
  // ─────────────────────────────────────────────────────────────────

  async expireStaleOrders(): Promise<number> {
    const expiredOrders = await db('orders')
      .whereIn('status', ['open', 'partially_filled'])
      .where('expires_at', '<', new Date())
      .select('*');

    let count = 0;
    for (const order of expiredOrders) {
      try {
        await this.cancelOrder(order.user_id, order.id);
        await db('orders')
          .where('id', order.id)
          .update({ status: 'expired', cancel_reason: 'Order expired', updated_at: new Date() });
        count++;
      } catch (err) {
        logger.warn('Failed to expire order', { orderId: order.id, error: (err as Error).message });
      }
    }

    return count;
  }

  // ─────────────────────────────────────────────────────────────────
  // ORDER BOOK SNAPSHOT
  // ─────────────────────────────────────────────────────────────────

  async getOrderBook(marketId: string, depth = 10): Promise<OrderBookSnapshot> {
    const cacheKey = `book:${marketId}:${depth}`;
    const cached = await orderBookCache.get<OrderBookSnapshot>(cacheKey);
    if (cached) return cached;

    // Aggregate open orders into price levels
    const [yesBids, yesAsks, noBids, noAsks] = await Promise.all([
      this.getLevels(marketId, 'yes', 'buy', depth),
      this.getLevels(marketId, 'yes', 'sell', depth),
      this.getLevels(marketId, 'no', 'buy', depth),
      this.getLevels(marketId, 'no', 'sell', depth),
    ]);

    const bestYesBid = yesBids[0]?.price ?? 0;
    const bestYesAsk = yesAsks[0]?.price ?? 1;
    const bestNoBid = noBids[0]?.price ?? 0;
    const bestNoAsk = noAsks[0]?.price ?? 1;

    const snapshot: OrderBookSnapshot = {
      marketId,
      yesBids,
      yesAsks,
      noBids,
      noAsks,
      spread: {
        yes: bestYesAsk - bestYesBid,
        no: bestNoAsk - bestNoBid,
      },
      midPrice: {
        yes: (bestYesBid + bestYesAsk) / 2,
        no: (bestNoBid + bestNoAsk) / 2,
      },
      timestamp: new Date().toISOString(),
    };

    await orderBookCache.set(cacheKey, snapshot, 2); // 2 second cache for order book
    return snapshot;
  }

  private async getLevels(
    marketId: string,
    side: 'yes' | 'no',
    action: 'buy' | 'sell',
    depth: number
  ): Promise<OrderBookLevel[]> {
    const orderBy = action === 'buy' ? 'desc' : 'asc';

    const rows = await db('orders')
      .where({ market_id: marketId, side, action, type: 'limit' })
      .whereIn('status', ['open', 'partially_filled'])
      .groupBy('price')
      .orderBy('price', orderBy)
      .limit(depth)
      .select(
        'price',
        db.raw('SUM(remaining_quantity) as quantity'),
        db.raw('COUNT(*) as order_count')
      );

    return rows.map((row: any) => ({
      price: parseFloat(row.price),
      quantity: parseFloat(row.quantity),
      orderCount: parseInt(row.order_count, 10),
    }));
  }

  // ─────────────────────────────────────────────────────────────────
  // QUERY ORDERS
  // ─────────────────────────────────────────────────────────────────

  async getUserOrders(userId: string, query: z.infer<typeof ListOrdersDto>) {
    const validated = ListOrdersDto.parse(query);

    let q = db('orders as o')
      .leftJoin('markets as m', 'o.market_id', 'm.id')
      .where('o.user_id', userId)
      .orderBy('o.created_at', 'desc')
      .select(
        'o.*',
        'm.title as market_title',
        'm.status as market_status',
        'm.current_yes_price',
        'm.current_no_price'
      );

    if (validated.status) q = q.where('o.status', validated.status);
    if (validated.marketId) q = q.where('o.market_id', validated.marketId);
    if (validated.side) q = q.where('o.side', validated.side);

    const result = await paginate(q, { page: validated.page, limit: validated.limit });

    return {
      ...result,
      data: result.data.map(this.formatOrder),
    };
  }

  async getOrderById(orderId: string, userId: string) {
    const order = await db('orders as o')
      .leftJoin('markets as m', 'o.market_id', 'm.id')
      .where('o.id', orderId)
      .select('o.*', 'm.title as market_title')
      .first();

    if (!order) throw new NotFoundError('Order', orderId);
    if (order.user_id !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not authorized', 403);
    }

    return this.formatOrder(order);
  }

  private formatOrder(order: any) {
    return {
      id: order.id,
      marketId: order.market_id,
      marketTitle: order.market_title,
      userId: order.user_id,
      side: order.side,
      type: order.type,
      action: order.action,
      status: order.status,
      price: parseFloat(order.price ?? 0),
      quantity: parseFloat(order.quantity),
      filledQuantity: parseFloat(order.filled_quantity ?? 0),
      remainingQuantity: parseFloat(order.remaining_quantity),
      averageFillPrice: order.average_fill_price ? parseFloat(order.average_fill_price) : null,
      totalCost: parseFloat(order.total_cost ?? 0),
      fee: parseFloat(order.fee_amount ?? 0),
      cancelReason: order.cancel_reason,
      expiresAt: order.expires_at,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
    };
  }
}
