/**
 * Order Book Service
 *
 * Order book service:
 * - supports resting LIMIT orders with order-to-order matching
 * - supports MARKET trades as a taker (sweep across resting orders)
 *
 * Order lifecycle:
 *   pending → open → partially_filled / filled
 *                  → cancelled / expired
 */

import { z } from 'zod';
import Decimal from 'decimal.js';
import { db, withTransaction, paginate } from '../../database/connection';
import { CacheService } from '../../infrastructure/redis/cache.service';
import {
  AppError,
  ErrorCode,
  NotFoundError,
  InsufficientBalanceError,
  SlippageExceededError,
} from '../../common/errors';
import { config } from '../../config';
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
      let reserveCashAmount: Decimal = new Decimal(0);
      let reserveCashFeeAmount: Decimal = new Decimal(0);

      if (validated.action === 'buy') {
        // BUY LIMIT:
        // reserve_cash = qty * limitPrice + fee (fee is computed on qty*limitPrice)
        const cost = price.mul(quantity);
        const fee = cost.mul(this.FEE_RATE);
        reserveCashAmount = cost.plus(fee);
        reserveCashFeeAmount = fee;
      } else {
        // SELL LIMIT:
        // reserve_shares happens via positions.reserved_quantity.
        const position = await trx('positions')
          .where({ user_id: userId, market_id: marketId, side: validated.side })
          .forUpdate()
          .first();

        const ownedShares = new Decimal(position?.quantity ?? 0);
        const reservedShares = new Decimal(position?.reserved_quantity ?? 0);
        const availableShares = ownedShares.minus(reservedShares);

        if (availableShares.lt(quantity)) {
          throw new AppError(
            ErrorCode.INSUFFICIENT_SHARES,
            `Insufficient shares: available ${availableShares.toFixed(4)}, need ${quantity.toFixed(4)}`,
            400
          );
        }

        // Lock shares for the order; position.quantity is NOT reduced at this stage.
        await trx('positions')
          .where({ user_id: userId, market_id: marketId, side: validated.side })
          .update({
            reserved_quantity: trx.raw('reserved_quantity + ?', [quantity.toFixed(8)]),
            updated_at: new Date(),
          });
      }

      // Reserve cash for buy orders (cash reserves must be split from shares reserves)
      if (validated.action === 'buy') {
        const balance = await trx('balances')
          .where('user_id', userId)
          .forUpdate()
          .first();

        if (!balance) throw new NotFoundError('Balance');

        const availableCash = new Decimal(balance.available_cash ?? balance.available);
        const reserveCash = reserveCashAmount;
        if (availableCash.lt(reserveCash)) {
          throw new InsufficientBalanceError(availableCash.toNumber(), reserveCash.toNumber());
        }

        await trx('balances')
          .where('user_id', userId)
          .update({
            available_cash: trx.raw('available_cash - ?', [reserveCashAmount.toFixed(8)]),
            reserved_cash: trx.raw('reserved_cash + ?', [reserveCashAmount.toFixed(8)]),
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
          total_cost: reserveCashAmount.toFixed(8),
          fee_amount: reserveCashFeeAmount.toFixed(8),
          expires_at: validated.expiresAt ? new Date(validated.expiresAt) : null,
          metadata: '{}',
        })
        .returning('*');

      // Attempt immediate matching
      await this.matchOrders(trx, marketId, order.id);
      // Bootstrapping matching on an empty market:
      // BUY YES can be paired with BUY NO when their prices sum to >= 1.
      if (validated.action === 'buy') {
        await this.matchComplementaryBuyOrders(trx, marketId, order.id);
      }

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
    takerOrderId: string
  ): Promise<void> {
    // Maker price matching (order book):
    // - taker BUY matches against best SELL makers (asks) with maker.price
    // - taker SELL matches against best BUY makers (bids) with maker.price
    const taker = await trx('orders')
      .where('id', takerOrderId)
      .forUpdate()
      .first();

    if (!taker) return;
    if (!['open', 'partially_filled'].includes(taker.status)) return;

    const side = taker.side as 'yes' | 'no';
    const takerAction = taker.action as 'buy' | 'sell';
    const takerPrice = new Decimal(taker.price);

    let takerRemaining = new Decimal(taker.remaining_quantity);
    const EPS = new Decimal('0.0000001');

    const makerQuery = trx('orders')
      .where({ market_id: marketId, side, type: 'limit' })
      .whereIn('status', ['open', 'partially_filled']);

    // Makers depend on taker action.
    if (takerAction === 'buy') {
      // Cross if taker.price >= maker.sell.price
      const makers = await makerQuery
        .andWhere({ action: 'sell' })
        .andWhere('price', '<=', takerPrice.toFixed(8))
        .orderBy('price', 'asc')
        .orderBy('created_at', 'asc')
        .forUpdate()
        .select('*');

      for (const maker of makers) {
        if (takerRemaining.lte(EPS)) break;
        const makerRemaining = new Decimal(maker.remaining_quantity);
        if (makerRemaining.lte(EPS)) continue;

        const fillQty = Decimal.min(takerRemaining, makerRemaining);
        const buyOrder = taker; // taker is the BUY
        const sellOrder = maker; // maker is the SELL
        const matchPrice = new Decimal(sellOrder.price); // maker price

        await this.executeFill(trx, marketId, buyOrder, sellOrder, fillQty, matchPrice);

        // Update local state for the next fill in this transaction.
        buyOrder.filled_quantity = new Decimal(buyOrder.filled_quantity).plus(fillQty).toFixed(8);
        buyOrder.remaining_quantity = new Decimal(buyOrder.remaining_quantity).minus(fillQty).toFixed(8);
        sellOrder.filled_quantity = new Decimal(sellOrder.filled_quantity).plus(fillQty).toFixed(8);
        sellOrder.remaining_quantity = new Decimal(sellOrder.remaining_quantity).minus(fillQty).toFixed(8);

        takerRemaining = new Decimal(taker.remaining_quantity);
      }
      return;
    }

    // takerAction === 'sell'
    // Cross if taker.price <= maker.buy.price
    const makers = await makerQuery
      .andWhere({ action: 'buy' })
      .andWhere('price', '>=', takerPrice.toFixed(8))
      .orderBy('price', 'desc')
      .orderBy('created_at', 'asc')
      .forUpdate()
      .select('*');

    for (const maker of makers) {
      if (takerRemaining.lte(EPS)) break;
      const makerRemaining = new Decimal(maker.remaining_quantity);
      if (makerRemaining.lte(EPS)) continue;

      const fillQty = Decimal.min(takerRemaining, makerRemaining);
      const buyOrder = maker; // maker is the BUY
      const sellOrder = taker; // taker is the SELL
      const matchPrice = new Decimal(buyOrder.price); // maker price

      await this.executeFill(trx, marketId, buyOrder, sellOrder, fillQty, matchPrice);

      buyOrder.filled_quantity = new Decimal(buyOrder.filled_quantity).plus(fillQty).toFixed(8);
      buyOrder.remaining_quantity = new Decimal(buyOrder.remaining_quantity).minus(fillQty).toFixed(8);
      sellOrder.filled_quantity = new Decimal(sellOrder.filled_quantity).plus(fillQty).toFixed(8);
      sellOrder.remaining_quantity = new Decimal(sellOrder.remaining_quantity).minus(fillQty).toFixed(8);

      takerRemaining = new Decimal(taker.remaining_quantity);
    }
  }

  private async matchComplementaryBuyOrders(
    trx: any,
    marketId: string,
    takerOrderId: string
  ): Promise<void> {
    const taker = await trx('orders')
      .where('id', takerOrderId)
      .forUpdate()
      .first();

    if (!taker) return;
    if (taker.action !== 'buy') return;
    if (!['open', 'partially_filled'].includes(taker.status)) return;

    const takerSide = taker.side as 'yes' | 'no';
    const oppositeSide: 'yes' | 'no' = takerSide === 'yes' ? 'no' : 'yes';
    const takerPrice = new Decimal(taker.price);
    const minOppositePrice = new Decimal(1).minus(takerPrice);
    const EPS = new Decimal('0.0000001');

    let takerRemaining = new Decimal(taker.remaining_quantity);

    const makers = await trx('orders')
      .where({
        market_id: marketId,
        action: 'buy',
        side: oppositeSide,
        type: 'limit',
      })
      .whereIn('status', ['open', 'partially_filled'])
      .andWhere('id', '!=', taker.id)
      .andWhere('price', '>=', minOppositePrice.toFixed(8))
      .orderBy('price', 'desc')
      .orderBy('created_at', 'asc')
      .forUpdate()
      .select('*');

    for (const maker of makers) {
      if (takerRemaining.lte(EPS)) break;

      const makerPrice = new Decimal(maker.price);
      if (takerPrice.plus(makerPrice).lt(1)) break;

      const makerRemaining = new Decimal(maker.remaining_quantity);
      if (makerRemaining.lte(EPS)) continue;

      const fillQty = Decimal.min(takerRemaining, makerRemaining);
      if (fillQty.lte(EPS)) continue;

      await this.executeComplementaryBuyFill(trx, marketId, taker, maker, fillQty);

      taker.filled_quantity = new Decimal(taker.filled_quantity).plus(fillQty).toFixed(8);
      taker.remaining_quantity = new Decimal(taker.remaining_quantity).minus(fillQty).toFixed(8);
      takerRemaining = new Decimal(taker.remaining_quantity);
    }
  }

  private async executeComplementaryBuyFill(
    trx: any,
    marketId: string,
    buyOrderA: any,
    buyOrderB: any,
    fillQty: Decimal
  ): Promise<void> {
    const sideA = buyOrderA.side as 'yes' | 'no';
    const sideB = buyOrderB.side as 'yes' | 'no';
    if (sideA === sideB) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'Complementary fill requires opposite sides', 500);
    }

    const priceA = new Decimal(buyOrderA.price);
    const priceB = new Decimal(buyOrderB.price);
    const principalA = fillQty.mul(priceA);
    const principalB = fillQty.mul(priceB);
    const feeA = principalA.mul(this.FEE_RATE);
    const feeB = principalB.mul(this.FEE_RATE);
    const reserveA = principalA.plus(feeA);
    const reserveB = principalB.plus(feeB);
    const collateral = fillQty;
    const surplus = Decimal.max(0, principalA.plus(principalB).minus(collateral));
    const platformCredit = feeA.plus(feeB).plus(surplus);

    const orderAFilled = new Decimal(buyOrderA.filled_quantity).plus(fillQty);
    const orderARemaining = new Decimal(buyOrderA.remaining_quantity).minus(fillQty);
    const orderAStatus = orderARemaining.lte(0.000001) ? 'filled' : 'partially_filled';
    await trx('orders')
      .where('id', buyOrderA.id)
      .update({
        filled_quantity: orderAFilled.toFixed(8),
        remaining_quantity: Decimal.max(0, orderARemaining).toFixed(8),
        status: orderAStatus,
        average_fill_price: priceA.toFixed(8),
        updated_at: new Date(),
      });

    const orderBFilled = new Decimal(buyOrderB.filled_quantity).plus(fillQty);
    const orderBRemaining = new Decimal(buyOrderB.remaining_quantity).minus(fillQty);
    const orderBStatus = orderBRemaining.lte(0.000001) ? 'filled' : 'partially_filled';
    await trx('orders')
      .where('id', buyOrderB.id)
      .update({
        filled_quantity: orderBFilled.toFixed(8),
        remaining_quantity: Decimal.max(0, orderBRemaining).toFixed(8),
        status: orderBStatus,
        average_fill_price: priceB.toFixed(8),
        updated_at: new Date(),
      });

    await this.upsertPositionFill(trx, buyOrderA.user_id, marketId, sideA, 'buy', fillQty, priceA);
    await this.upsertPositionFill(trx, buyOrderB.user_id, marketId, sideB, 'buy', fillQty, priceB);

    const balanceA = await trx('balances').where('user_id', buyOrderA.user_id).forUpdate().first();
    const aAvailBefore = new Decimal(balanceA.available_cash ?? balanceA.available);
    const aResBefore = new Decimal(balanceA.reserved_cash ?? balanceA.reserved);
    const aTotalBefore = aAvailBefore.plus(aResBefore);
    await trx('balances')
      .where('user_id', buyOrderA.user_id)
      .update({
        reserved_cash: trx.raw('reserved_cash - ?', [reserveA.toFixed(8)]),
        reserved: trx.raw('reserved - ?', [reserveA.toFixed(8)]),
        total: trx.raw('total - ?', [reserveA.toFixed(8)]),
        updated_at: new Date(),
      });
    await trx('balance_transactions').insert({
      user_id: buyOrderA.user_id,
      type: 'trade_debit',
      amount: reserveA.toFixed(8),
      balance_before: aTotalBefore.toFixed(8),
      balance_after: aTotalBefore.minus(reserveA).toFixed(8),
      reference_type: 'trade',
      reference_id: null,
      description: `Complementary fill: bought ${fillQty.toFixed(4)} ${sideA.toUpperCase()} @ ${priceA.toFixed(4)}`,
    });

    const balanceB = await trx('balances').where('user_id', buyOrderB.user_id).forUpdate().first();
    const bAvailBefore = new Decimal(balanceB.available_cash ?? balanceB.available);
    const bResBefore = new Decimal(balanceB.reserved_cash ?? balanceB.reserved);
    const bTotalBefore = bAvailBefore.plus(bResBefore);
    await trx('balances')
      .where('user_id', buyOrderB.user_id)
      .update({
        reserved_cash: trx.raw('reserved_cash - ?', [reserveB.toFixed(8)]),
        reserved: trx.raw('reserved - ?', [reserveB.toFixed(8)]),
        total: trx.raw('total - ?', [reserveB.toFixed(8)]),
        updated_at: new Date(),
      });
    await trx('balance_transactions').insert({
      user_id: buyOrderB.user_id,
      type: 'trade_debit',
      amount: reserveB.toFixed(8),
      balance_before: bTotalBefore.toFixed(8),
      balance_after: bTotalBefore.minus(reserveB).toFixed(8),
      reference_type: 'trade',
      reference_id: null,
      description: `Complementary fill: bought ${fillQty.toFixed(4)} ${sideB.toUpperCase()} @ ${priceB.toFixed(4)}`,
    });

    const feeAccount = await this.getFeeAccount(trx);
    if (feeAccount && platformCredit.gt(0)) {
      const platformBalance = await trx('balances').where('user_id', feeAccount.id).forUpdate().first();
      const pAvailBefore = new Decimal(platformBalance.available_cash ?? platformBalance.available);
      const pResBefore = new Decimal(platformBalance.reserved_cash ?? platformBalance.reserved);
      const pTotalBefore = pAvailBefore.plus(pResBefore);
      await trx('balances')
        .where('user_id', feeAccount.id)
        .update({
          available_cash: trx.raw('available_cash + ?', [platformCredit.toFixed(8)]),
          available: trx.raw('available + ?', [platformCredit.toFixed(8)]),
          total: trx.raw('total + ?', [platformCredit.toFixed(8)]),
          updated_at: new Date(),
        });
      await trx('balance_transactions').insert({
        user_id: feeAccount.id,
        type: 'fee',
        amount: platformCredit.toFixed(8),
        balance_before: pTotalBefore.toFixed(8),
        balance_after: pTotalBefore.plus(platformCredit).toFixed(8),
        reference_type: 'trade',
        reference_id: null,
        description: `Complementary buy spread+fees for market ${marketId}`,
      });
    }

    const yesPrice = sideA === 'yes' ? priceA : new Decimal(1).minus(priceB);
    const noPrice = new Decimal(1).minus(yesPrice);
    const marketVolume = principalA.plus(principalB);

    await trx('markets')
      .where('id', marketId)
      .update({
        current_yes_price: yesPrice.toFixed(8),
        current_no_price: noPrice.toFixed(8),
        yes_shares: trx.raw('yes_shares + ?', [fillQty.toFixed(8)]),
        no_shares: trx.raw('no_shares + ?', [fillQty.toFixed(8)]),
        liquidity_total: trx.raw('liquidity_total + ?', [collateral.toFixed(8)]),
        volume_24h: trx.raw('volume_24h + ?', [marketVolume.toFixed(8)]),
        volume_total: trx.raw('volume_total + ?', [marketVolume.toFixed(8)]),
        trade_count: trx.raw('trade_count + 2'),
        updated_at: new Date(),
      });
    await trx('price_history').insert({
      market_id: marketId,
      yes_price: yesPrice.toFixed(8),
      no_price: noPrice.toFixed(8),
      volume: marketVolume.toFixed(8),
      trade_count: 2,
      recorded_at: new Date(),
    });

    const [tradeA] = await trx('trades')
      .insert({
        market_id: marketId,
        buyer_id: buyOrderA.user_id,
        seller_id: null,
        buyer_order_id: buyOrderA.id,
        seller_order_id: null,
        side: sideA,
        trade_type: 'order_book',
        price: priceA.toFixed(8),
        quantity: fillQty.toFixed(8),
        total_value: principalA.toFixed(8),
        fee: feeA.toFixed(8),
        yes_price_before: yesPrice.toFixed(8),
        yes_price_after: yesPrice.toFixed(8),
        price_impact: '0',
        executed_at: new Date(),
        metadata: JSON.stringify({ complementaryMint: true, counterpartyOrderId: buyOrderB.id }),
      })
      .returning('*');

    const [tradeB] = await trx('trades')
      .insert({
        market_id: marketId,
        buyer_id: buyOrderB.user_id,
        seller_id: null,
        buyer_order_id: buyOrderB.id,
        seller_order_id: null,
        side: sideB,
        trade_type: 'order_book',
        price: priceB.toFixed(8),
        quantity: fillQty.toFixed(8),
        total_value: principalB.toFixed(8),
        fee: feeB.toFixed(8),
        yes_price_before: yesPrice.toFixed(8),
        yes_price_after: yesPrice.toFixed(8),
        price_impact: '0',
        executed_at: new Date(),
        metadata: JSON.stringify({ complementaryMint: true, counterpartyOrderId: buyOrderA.id }),
      })
      .returning('*');

    void tradeA;
    void tradeB;
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
    const fee = totalValue.mul(this.FEE_RATE); // fee on trade value (same for both sides)
    const buyerFee = fee;
    const sellerFee = fee;
    const buyerCost = totalValue.plus(buyerFee); // qty * price + fee
    const sellerReceives = totalValue.minus(sellerFee); // qty * price - fee
    const platformFee = buyerFee.plus(sellerFee); // 2 * fee_rate * total_value

    const market = await trx('markets').where('id', marketId).first();
    const yesBefore = new Decimal(market.current_yes_price);
    const noBefore = new Decimal(market.current_no_price);

    // After-trade probabilities (price is always probability of the traded side)
    const tradedSide = buyOrder.side as 'yes' | 'no';
    const yesAfter = tradedSide === 'yes' ? matchPrice : new Decimal(1).minus(matchPrice);
    const noAfter = tradedSide === 'yes' ? new Decimal(1).minus(matchPrice) : matchPrice;

    const priceImpactPct = yesBefore.eq(0)
      ? new Decimal(0)
      : yesAfter.minus(yesBefore).abs().div(yesBefore).mul(100);

    // Create trade record
    const [trade] = await trx('trades')
      .insert({
        market_id: marketId,
        buyer_id: buyOrder.user_id,
        seller_id: sellOrder.user_id,
        buyer_order_id: buyOrder.id,
        seller_order_id: sellOrder.id,
        side: tradedSide,
        trade_type: 'order_book',
        price: matchPrice.toFixed(8),
        quantity: fillQty.toFixed(8),
        total_value: totalValue.toFixed(8),
        fee: platformFee.toFixed(8),
        yes_price_before: yesBefore.toFixed(8),
        yes_price_after: yesAfter.toFixed(8),
        price_impact: priceImpactPct.toFixed(8),
        executed_at: new Date(),
        metadata: JSON.stringify({ orderBook: true }),
      })
      .returning('*');

    // Update maker/taker orders' fill state
    const buyFilled = new Decimal(buyOrder.filled_quantity).plus(fillQty);
    const buyRemaining = new Decimal(buyOrder.remaining_quantity).minus(fillQty);
    const buyStatus = buyRemaining.lte(0.000001) ? 'filled' : 'partially_filled';

    const sellFilled = new Decimal(sellOrder.filled_quantity).plus(fillQty);
    const sellRemaining = new Decimal(sellOrder.remaining_quantity).minus(fillQty);
    const sellStatus = sellRemaining.lte(0.000001) ? 'filled' : 'partially_filled';

    await trx('orders')
      .where('id', buyOrder.id)
      .update({
        filled_quantity: buyFilled.toFixed(8),
        remaining_quantity: Decimal.max(0, buyRemaining).toFixed(8),
        status: buyStatus,
        average_fill_price: matchPrice.toFixed(8),
        updated_at: new Date(),
      });

    await trx('orders')
      .where('id', sellOrder.id)
      .update({
        filled_quantity: sellFilled.toFixed(8),
        remaining_quantity: Decimal.max(0, sellRemaining).toFixed(8),
        status: sellStatus,
        average_fill_price: matchPrice.toFixed(8),
        updated_at: new Date(),
      });

    // ── Positions first (shares state)
    await this.upsertPositionFill(trx, buyOrder.user_id, marketId, buyOrder.side, 'buy', fillQty, matchPrice);
    await this.upsertPositionFill(trx, sellOrder.user_id, marketId, sellOrder.side, 'sell', fillQty, matchPrice);

    // ── Cash state (cash reserves + available)
    const feeAccount = await this.getFeeAccount(trx);

    const buyerBalance = await trx('balances')
      .where('user_id', buyOrder.user_id)
      .forUpdate()
      .first();
    const buyerAvailBefore = new Decimal(buyerBalance.available_cash ?? buyerBalance.available);
    const buyerResBefore = new Decimal(buyerBalance.reserved_cash ?? buyerBalance.reserved);
    const buyerTotalBefore = buyerAvailBefore.plus(buyerResBefore);

    // reserved_cash was computed at buyOrder.price, not matchPrice
    const reservedCashForFill = fillQty
      .mul(new Decimal(buyOrder.price))
      .mul(new Decimal(1).plus(this.FEE_RATE));

    const buyerRefund = Decimal.max(0, reservedCashForFill.minus(buyerCost));

    const buyerAvailAfter = buyerAvailBefore.plus(buyerRefund);
    const buyerResAfter = buyerResBefore.minus(reservedCashForFill);
    const buyerTotalAfter = buyerAvailAfter.plus(buyerResAfter);

    await trx('balances')
      .where('user_id', buyOrder.user_id)
      .update({
        available_cash: trx.raw('available_cash + ?', [buyerRefund.toFixed(8)]),
        reserved_cash: trx.raw('reserved_cash - ?', [reservedCashForFill.toFixed(8)]),
        available: trx.raw('available + ?', [buyerRefund.toFixed(8)]),
        reserved: trx.raw('reserved - ?', [reservedCashForFill.toFixed(8)]),
        total: trx.raw('total - ?', [buyerCost.toFixed(8)]),
        updated_at: new Date(),
      });

    await trx('balance_transactions').insert({
      user_id: buyOrder.user_id,
      type: 'trade_debit',
      amount: buyerCost.toFixed(8),
      balance_before: buyerTotalBefore.toFixed(8),
      balance_after: buyerTotalAfter.toFixed(8),
      reference_type: 'trade',
      reference_id: trade.id,
      description: `Limit fill: bought ${fillQty.toFixed(4)} ${tradedSide.toUpperCase()} @ ${matchPrice.toFixed(4)}`,
    });

    const sellerBalance = await trx('balances')
      .where('user_id', sellOrder.user_id)
      .forUpdate()
      .first();
    const sellerAvailBefore = new Decimal(sellerBalance.available_cash ?? sellerBalance.available);
    const sellerResBefore = new Decimal(sellerBalance.reserved_cash ?? sellerBalance.reserved);
    const sellerTotalBefore = sellerAvailBefore.plus(sellerResBefore);

    const sellerAvailAfter = sellerAvailBefore.plus(sellerReceives);
    const sellerResAfter = sellerResBefore;
    const sellerTotalAfter = sellerAvailAfter.plus(sellerResAfter);

    await trx('balances')
      .where('user_id', sellOrder.user_id)
      .update({
        available_cash: trx.raw('available_cash + ?', [sellerReceives.toFixed(8)]),
        available: trx.raw('available + ?', [sellerReceives.toFixed(8)]),
        total: trx.raw('total + ?', [sellerReceives.toFixed(8)]),
        updated_at: new Date(),
      });

    await trx('balance_transactions').insert({
      user_id: sellOrder.user_id,
      type: 'trade_credit',
      amount: sellerReceives.toFixed(8),
      balance_before: sellerTotalBefore.toFixed(8),
      balance_after: sellerTotalAfter.toFixed(8),
      reference_type: 'trade',
      reference_id: trade.id,
      description: `Limit fill: sold ${fillQty.toFixed(4)} ${tradedSide.toUpperCase()} @ ${matchPrice.toFixed(4)}`,
    });

    // Credit platform fee sink so total cash doesn't disappear.
    if (feeAccount) {
      const platformBalance = await trx('balances')
        .where('user_id', feeAccount.id)
        .forUpdate()
        .first();
      const platformAvailBefore = new Decimal(platformBalance.available_cash ?? platformBalance.available);
      const platformResBefore = new Decimal(platformBalance.reserved_cash ?? platformBalance.reserved);
      const platformTotalBefore = platformAvailBefore.plus(platformResBefore);

      const platformAvailAfter = platformAvailBefore.plus(platformFee);
      const platformResAfter = platformResBefore;
      const platformTotalAfter = platformAvailAfter.plus(platformResAfter);

      await trx('balances')
        .where('user_id', feeAccount.id)
        .update({
          available_cash: trx.raw('available_cash + ?', [platformFee.toFixed(8)]),
          available: trx.raw('available + ?', [platformFee.toFixed(8)]),
          total: trx.raw('total + ?', [platformFee.toFixed(8)]),
          updated_at: new Date(),
        });

      await trx('balance_transactions').insert({
        user_id: feeAccount.id,
        type: 'fee',
        amount: platformFee.toFixed(8),
        balance_before: platformTotalBefore.toFixed(8),
        balance_after: platformTotalAfter.toFixed(8),
        reference_type: 'trade',
        reference_id: trade.id,
        description: `Platform fee collected for trade ${trade.id}`,
      });
    }

    // Update market current prices + stats
    await trx('markets')
      .where('id', marketId)
      .update({
        current_yes_price: yesAfter.toFixed(8),
        current_no_price: noAfter.toFixed(8),
        volume_24h: trx.raw('volume_24h + ?', [totalValue.toFixed(8)]),
        volume_total: trx.raw('volume_total + ?', [totalValue.toFixed(8)]),
        trade_count: trx.raw('trade_count + 1'),
        updated_at: new Date(),
      });

    await trx('price_history').insert({
      market_id: marketId,
      yes_price: yesAfter.toFixed(8),
      no_price: noAfter.toFixed(8),
      volume: totalValue.toFixed(8),
      trade_count: 1,
      recorded_at: new Date(),
    });

    logger.debug('Order book fill executed', {
      tradeId: trade.id,
      buyOrderId: buyOrder.id,
      sellOrderId: sellOrder.id,
      qty: fillQty.toFixed(4),
      price: matchPrice.toFixed(4),
    });
  }

  private async getFeeAccount(trx: any): Promise<{ id: string } | null> {
    const feeAccount = await trx('users')
      .where('username', 'exchange')
      .select('id')
      .first();
    return feeAccount ?? null;
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
      .forUpdate()
      .first();

    if (action === 'buy') {
      if (!existing) {
        await trx('positions').insert({
          user_id: userId,
          market_id: marketId,
          side,
          quantity: qty.toFixed(8),
          reserved_quantity: '0',
          average_price: price.toFixed(8), // entry for UI
          // Net spend includes the buyer-side fee immediately.
          total_invested: qty.mul(price).mul(new Decimal(1).plus(this.FEE_RATE)).toFixed(8),
          realized_pnl: '0',
          unrealized_pnl: '0',
          trade_count: 1,
          last_trade_at: new Date(),
        });
        return;
      }

      const existingQty = new Decimal(existing.quantity);
      const existingAvg = new Decimal(existing.average_price);
      const existingReserved = new Decimal(existing.reserved_quantity ?? 0);

      const newQty = existingQty.plus(qty);
      const newAvg = existingQty.eq(0)
        ? price
        : existingAvg.mul(existingQty).plus(price.mul(qty)).div(newQty);

      await trx('positions')
        .where({ user_id: userId, market_id: marketId, side })
        .update({
          quantity: newQty.toFixed(8),
          // Buying increases total shares; it doesn't free/lock shares.
          reserved_quantity: existingReserved.toFixed(8),
          average_price: newAvg.toFixed(8),
          total_invested: newAvg.mul(newQty).mul(new Decimal(1).plus(this.FEE_RATE)).toFixed(8),
          trade_count: trx.raw('trade_count + 1'),
          last_trade_at: new Date(),
          updated_at: new Date(),
        });
      return;
    }

    // SELL fill:
    // - reduce total shares (positions.quantity) by qty
    // - reduce reserved shares (positions.reserved_quantity) by qty
    if (!existing) {
      throw new AppError(ErrorCode.INSUFFICIENT_SHARES, 'Missing position for sell fill', 400);
    }

    const currentQty = new Decimal(existing.quantity);
    const currentReserved = new Decimal(existing.reserved_quantity ?? 0);
    if (currentReserved.lt(qty)) {
      throw new AppError(
        ErrorCode.INSUFFICIENT_SHARES,
        `Insufficient reserved shares: reserved ${currentReserved.toFixed(4)}, need ${qty.toFixed(4)}`,
        400
      );
    }

    const newQty = currentQty.minus(qty);
    const newReserved = currentReserved.minus(qty);

    const avgPrice = new Decimal(existing.average_price);

    await trx('positions')
      .where({ user_id: userId, market_id: marketId, side })
      .update({
        quantity: Decimal.max(0, newQty).toFixed(8),
        reserved_quantity: Decimal.max(0, newReserved).toFixed(8),
        average_price: newQty.lte(0) ? '0' : avgPrice.toFixed(8),
        total_invested: newQty.lte(0) ? '0' : avgPrice.mul(newQty).mul(new Decimal(1).plus(this.FEE_RATE)).toFixed(8),
        trade_count: trx.raw('trade_count + 1'),
        last_trade_at: new Date(),
        updated_at: new Date(),
      });
  }

  // ─────────────────────────────────────────────────────────────────
  // MARKET TRADES (taker against resting limit orders)
  // ─────────────────────────────────────────────────────────────────

  async getTradeQuote(
    marketId: string,
    side: 'yes' | 'no',
    action: 'buy' | 'sell',
    amount: number
  ): Promise<{
    shares: number;
    totalCost: number;
    averagePrice: number;
    priceImpact: number;
    fee: number;
    priceAfter: number;
  }> {
    const market = await db('markets').where('id', marketId).first();
    if (!market) throw new NotFoundError('Market', marketId);
    if (market.status !== 'active') throw new AppError(ErrorCode.MARKET_INACTIVE, `Market is ${market.status}`, 400);
    if (new Date(market.closes_at) <= new Date()) throw new AppError(ErrorCode.MARKET_CLOSED, 'Market has closed', 400);

    const feeRate = this.FEE_RATE;
    const yesBefore = new Decimal(market.current_yes_price);
    const noBefore = new Decimal(market.current_no_price);

    // Read-only sweep across the book.
    if (action === 'buy') {
      // amount is USD budget that includes fees (like the existing frontend contract)
      const budget = new Decimal(amount);
      const makers = await db('orders')
        .where({ market_id: marketId, side, action: 'sell', type: 'limit' })
        .whereIn('status', ['open', 'partially_filled'])
        .orderBy('price', 'asc')
        .orderBy('created_at', 'asc')
        .select('*');

      let cashRemaining = budget;
      let totalShares = new Decimal(0);
      let totalTradeValue = new Decimal(0);
      let totalUserFee = new Decimal(0);

      const EPS = new Decimal('0.0000001');
      for (const maker of makers) {
        if (cashRemaining.lte(EPS)) break;
        const makerPrice = new Decimal(maker.price);
        const makerRemaining = new Decimal(maker.remaining_quantity);
        if (makerRemaining.lte(EPS)) continue;

        const maxQty = cashRemaining.div(makerPrice.mul(new Decimal(1).plus(feeRate)));
        const fillQty = Decimal.min(makerRemaining, maxQty);
        if (fillQty.lte(EPS)) continue;

        const tradeValue = fillQty.mul(makerPrice);
        const userFee = tradeValue.mul(feeRate); // buyer pays fee

        const cost = tradeValue.plus(userFee);
        if (cost.gt(cashRemaining)) break;

        cashRemaining = cashRemaining.minus(cost);
        totalShares = totalShares.plus(fillQty);
        totalTradeValue = totalTradeValue.plus(tradeValue);
        totalUserFee = totalUserFee.plus(userFee);
      }

      if (totalShares.lte(EPS)) {
        throw new AppError(ErrorCode.INVALID_TRADE_AMOUNT, 'No enough liquidity to execute market buy', 400);
      }

      const averagePrice = totalTradeValue.div(totalShares);
      const tradedSide = side;
      const yesAfter = tradedSide === 'yes' ? averagePrice : new Decimal(1).minus(averagePrice);
      const noAfter = tradedSide === 'yes' ? new Decimal(1).minus(averagePrice) : averagePrice;
      const priceImpact = yesBefore.eq(0) ? new Decimal(0) : yesAfter.minus(yesBefore).abs().div(yesBefore).mul(100);

      return {
        shares: totalShares.toNumber(),
        totalCost: budget.minus(cashRemaining).toNumber(),
        averagePrice: averagePrice.toNumber(),
        priceImpact: priceImpact.toNumber(),
        fee: totalUserFee.toNumber(),
        priceAfter: (side === 'yes' ? yesAfter : noAfter).toNumber(),
      };
    }

    // action === 'sell': amount is shares to sell
    const sharesToSell = new Decimal(amount);
    const makers = await db('orders')
      .where({ market_id: marketId, side, action: 'buy', type: 'limit' })
      .whereIn('status', ['open', 'partially_filled'])
      .orderBy('price', 'desc')
      .orderBy('created_at', 'asc')
      .select('*');

    let remainingShares = sharesToSell;
    let totalShares = new Decimal(0);
    let totalTradeValue = new Decimal(0);
    let totalUserFee = new Decimal(0);

    const EPS = new Decimal('0.0000001');
    for (const maker of makers) {
      if (remainingShares.lte(EPS)) break;
      const makerPrice = new Decimal(maker.price);
      const makerRemaining = new Decimal(maker.remaining_quantity);
      if (makerRemaining.lte(EPS)) continue;

      const fillQty = Decimal.min(remainingShares, makerRemaining);
      if (fillQty.lte(EPS)) continue;

      const tradeValue = fillQty.mul(makerPrice);
      const userFee = tradeValue.mul(feeRate); // seller fee
      const proceeds = tradeValue.minus(userFee);

      totalShares = totalShares.plus(fillQty);
      totalTradeValue = totalTradeValue.plus(tradeValue);
      totalUserFee = totalUserFee.plus(userFee);

      remainingShares = remainingShares.minus(fillQty);
      // If market buy maker orders are insufficient, we stop at book exhaustion.
      // proceeds is computed below from totals.
      void proceeds;
    }

    if (totalShares.lte(EPS)) {
      throw new AppError(ErrorCode.INVALID_TRADE_AMOUNT, 'No enough liquidity to execute market sell', 400);
    }

    const averagePrice = totalTradeValue.div(totalShares);
    const tradedSide = side;
    const yesAfter = tradedSide === 'yes' ? averagePrice : new Decimal(1).minus(averagePrice);
    const priceImpact = yesBefore.eq(0) ? new Decimal(0) : yesAfter.minus(yesBefore).abs().div(yesBefore).mul(100);
    const totalValue = totalTradeValue;
    const totalProceeds = totalValue.minus(totalUserFee);

    return {
      shares: totalShares.toNumber(),
      totalCost: totalProceeds.toNumber(),
      averagePrice: averagePrice.toNumber(),
      priceImpact: priceImpact.toNumber(),
      fee: totalUserFee.toNumber(),
      priceAfter: (side === 'yes' ? yesAfter : new Decimal(1).minus(yesAfter)).toNumber(),
    };
  }

  async executeMarketTrade(
    params: {
      userId: string;
      marketId: string;
      side: 'yes' | 'no';
      action: 'buy' | 'sell';
      amount: number; // USD for buy (budget), shares for sell
      maxSlippage?: number;
      expectedPrice?: number;
    }
  ): Promise<{
    tradeId: string;
    sharesTransacted: number;
    totalCost: number;
    averagePrice: number;
    priceImpact: number;
    yesPriceBefore: number;
    yesPriceAfter: number;
    fee: number;
    newBalance: number;
  }> {
    const { userId, marketId, side, action, amount, maxSlippage = 5, expectedPrice } = params;

    if (amount < config.MIN_TRADE_AMOUNT) {
      throw new AppError(ErrorCode.MIN_TRADE_AMOUNT, `Minimum trade amount is ${config.MIN_TRADE_AMOUNT}`, 400);
    }
    if (amount > config.MAX_TRADE_AMOUNT) {
      throw new AppError(ErrorCode.MAX_TRADE_AMOUNT, `Maximum trade amount is ${config.MAX_TRADE_AMOUNT}`, 400);
    }

    return withTransaction(async (trx) => {
      const market = await trx('markets').where('id', marketId).forUpdate().first();
      if (!market) throw new AppError(ErrorCode.MARKET_NOT_FOUND, 'Market not found', 404);
      if (market.status !== 'active') throw new AppError(ErrorCode.MARKET_INACTIVE, `Market is ${market.status}`, 400);
      if (new Date(market.closes_at) <= new Date()) throw new AppError(ErrorCode.MARKET_CLOSED, 'Market has closed', 400);

      const yesBefore = new Decimal(market.current_yes_price);
      const noBefore = new Decimal(market.current_no_price);

      const feeRate = this.FEE_RATE;
      const EPS = new Decimal('0.0000001');
      const feeAccount = await this.getFeeAccount(trx);

      const buyerUserId = userId;
      const sellerUserId = userId;

      let totalShares = new Decimal(0);
      let totalTradeValue = new Decimal(0);
      let totalUserFee = new Decimal(0);
      let totalCost = new Decimal(0); // buyer cost (buy) or seller proceeds (sell)

      let tradedSide: 'yes' | 'no' = side;

      if (action === 'buy') {
        const budget = new Decimal(amount);
        const balance = await trx('balances').where('user_id', userId).forUpdate().first();
        const availableCash = new Decimal(balance.available_cash ?? balance.available);
        if (availableCash.lt(budget)) {
          throw new InsufficientBalanceError(availableCash.toNumber(), budget.toNumber());
        }

        let cashRemaining = budget;

        const makers = await trx('orders')
          .where({ market_id: marketId, side, action: 'sell', type: 'limit' })
          .whereIn('status', ['open', 'partially_filled'])
          .orderBy('price', 'asc')
          .orderBy('created_at', 'asc')
          .forUpdate()
          .select('*');

        for (const maker of makers) {
          if (cashRemaining.lte(EPS)) break;
          const makerPrice = new Decimal(maker.price);
          const makerRemaining = new Decimal(maker.remaining_quantity);
          if (makerRemaining.lte(EPS)) continue;

          const maxQty = cashRemaining.div(makerPrice.mul(new Decimal(1).plus(feeRate)));
          const fillQty = Decimal.min(makerRemaining, maxQty);
          if (fillQty.lte(EPS)) continue;

          const tradeValue = fillQty.mul(makerPrice);
          const userFee = tradeValue.mul(feeRate);
          const cost = tradeValue.plus(userFee); // buyer pays including fee
          if (cost.gt(cashRemaining)) break;

          // Update resting sell order state
          const makerFilled = new Decimal(maker.filled_quantity).plus(fillQty);
          const makerRemainingAfter = makerRemaining.minus(fillQty);
          const makerStatus = makerRemainingAfter.lte(EPS) ? 'filled' : 'partially_filled';
          await trx('orders')
            .where('id', maker.id)
            .update({
              filled_quantity: makerFilled.toFixed(8),
              remaining_quantity: makerRemainingAfter.toFixed(8),
              status: makerStatus,
              average_fill_price: makerPrice.toFixed(8),
              updated_at: new Date(),
            });

          // Positions: buyer gets shares, maker seller reduces reserved shares.
          await this.upsertPositionFill(trx, userId, marketId, side, 'buy', fillQty, makerPrice);
          await this.upsertPositionFill(trx, maker.user_id, marketId, side, 'sell', fillQty, makerPrice);

          // Cash: debit buyer from available_cash, credit seller, credit platform fee sink.
          const buyerBalance = await trx('balances').where('user_id', userId).forUpdate().first();
          const buyerAvailBefore = new Decimal(buyerBalance.available_cash ?? buyerBalance.available);
          const buyerTotalBefore = buyerAvailBefore.plus(new Decimal(buyerBalance.reserved_cash ?? buyerBalance.reserved));

          await trx('balances')
            .where('user_id', userId)
            .update({
              available_cash: trx.raw('available_cash - ?', [cost.toFixed(8)]),
              available: trx.raw('available - ?', [cost.toFixed(8)]),
              total: trx.raw('total - ?', [cost.toFixed(8)]),
              updated_at: new Date(),
            });

          const sellerProceeds = tradeValue.minus(tradeValue.mul(feeRate));
          const sellerBalance = await trx('balances').where('user_id', maker.user_id).forUpdate().first();
          const sellerAvailBefore = new Decimal(sellerBalance.available_cash ?? sellerBalance.available);
          const sellerResBefore = new Decimal(sellerBalance.reserved_cash ?? sellerBalance.reserved);
          const sellerTotalBefore = sellerAvailBefore.plus(sellerResBefore);

          await trx('balances')
            .where('user_id', maker.user_id)
            .update({
              available_cash: trx.raw('available_cash + ?', [sellerProceeds.toFixed(8)]),
              available: trx.raw('available + ?', [sellerProceeds.toFixed(8)]),
              total: trx.raw('total + ?', [sellerProceeds.toFixed(8)]),
              updated_at: new Date(),
            });

          const platformFee = tradeValue.mul(feeRate).mul(2); // buyerFee + sellerFee
          if (feeAccount) {
            const platformBalance = await trx('balances').where('user_id', feeAccount.id).forUpdate().first();
            await trx('balances')
              .where('user_id', feeAccount.id)
              .update({
                available_cash: trx.raw('available_cash + ?', [platformFee.toFixed(8)]),
                available: trx.raw('available + ?', [platformFee.toFixed(8)]),
                total: trx.raw('total + ?', [platformFee.toFixed(8)]),
                updated_at: new Date(),
              });
          }

          // Trade record + balance transactions
          const platformSellerFee = tradeValue.mul(feeRate);
          const feeTotalForTrade = platformFee;

          const marketNow = await trx('markets').where('id', marketId).first();
          const yesBeforeFill = new Decimal(marketNow.current_yes_price);
          const yesAfterFill = side === 'yes' ? makerPrice : new Decimal(1).minus(makerPrice);
          const noAfterFill = side === 'yes' ? new Decimal(1).minus(makerPrice) : makerPrice;
          const priceImpact = yesBeforeFill.eq(0) ? new Decimal(0) : yesAfterFill.minus(yesBeforeFill).abs().div(yesBeforeFill).mul(100);

          const [tradeRow] = await trx('trades')
            .insert({
              market_id: marketId,
              buyer_id: userId,
              seller_id: maker.user_id,
              buyer_order_id: null,
              seller_order_id: maker.id,
              side: side,
              trade_type: 'order_book',
              price: makerPrice.toFixed(8),
              quantity: fillQty.toFixed(8),
              total_value: tradeValue.toFixed(8),
              fee: feeTotalForTrade.toFixed(8),
              yes_price_before: yesBeforeFill.toFixed(8),
              yes_price_after: yesAfterFill.toFixed(8),
              price_impact: priceImpact.toFixed(8),
              executed_at: new Date(),
              metadata: JSON.stringify({ orderBook: true, taker: true }),
            })
            .returning('*');

          const buyerBalanceAfter = await trx('balances').where('user_id', userId).first();
          const buyerTotalAfter = new Decimal(buyerBalanceAfter.available_cash ?? buyerBalanceAfter.available)
            .plus(new Decimal(buyerBalanceAfter.reserved_cash ?? buyerBalanceAfter.reserved));
          await trx('balance_transactions').insert({
            user_id: userId,
            type: 'trade_debit',
            amount: cost.toFixed(8),
            balance_before: buyerTotalBefore.toFixed(8),
            balance_after: buyerTotalAfter.toFixed(8),
            reference_type: 'trade',
            reference_id: tradeRow.id,
            description: `Market fill: bought ${fillQty.toFixed(4)} ${side.toUpperCase()} @ ${makerPrice.toFixed(4)}`,
          });

          const sellerBalanceAfter = await trx('balances').where('user_id', maker.user_id).first();
          const sellerTotalAfter = new Decimal(sellerBalanceAfter.available_cash ?? sellerBalanceAfter.available)
            .plus(new Decimal(sellerBalanceAfter.reserved_cash ?? sellerBalanceAfter.reserved));
          await trx('balance_transactions').insert({
            user_id: maker.user_id,
            type: 'trade_credit',
            amount: sellerProceeds.toFixed(8),
            balance_before: sellerTotalBefore.toFixed(8),
            balance_after: sellerTotalAfter.toFixed(8),
            reference_type: 'trade',
            reference_id: tradeRow.id,
            description: `Market fill: sold ${fillQty.toFixed(4)} ${side.toUpperCase()} @ ${makerPrice.toFixed(4)}`,
          });

          if (feeAccount) {
            const platformBalanceAfter = await trx('balances').where('user_id', feeAccount.id).first();
            const platformTotalAfter = new Decimal(platformBalanceAfter.available_cash ?? platformBalanceAfter.available)
              .plus(new Decimal(platformBalanceAfter.reserved_cash ?? platformBalanceAfter.reserved));
            // platform fee account balance_before can be computed by subtracting platformFee from after
            await trx('balance_transactions').insert({
              user_id: feeAccount.id,
              type: 'fee',
              amount: platformFee.toFixed(8),
              balance_before: platformTotalAfter.minus(platformFee).toFixed(8),
              balance_after: platformTotalAfter.toFixed(8),
              reference_type: 'trade',
              reference_id: tradeRow.id,
              description: `Platform fee collected for market trade ${tradeRow.id}`,
            });
          }

          // Update market prices and market stats
          await trx('markets')
            .where('id', marketId)
            .update({
              current_yes_price: yesAfterFill.toFixed(8),
              current_no_price: noAfterFill.toFixed(8),
              volume_24h: trx.raw('volume_24h + ?', [tradeValue.toFixed(8)]),
              volume_total: trx.raw('volume_total + ?', [tradeValue.toFixed(8)]),
              trade_count: trx.raw('trade_count + 1'),
              updated_at: new Date(),
            });
          await trx('price_history').insert({
            market_id: marketId,
            yes_price: yesAfterFill.toFixed(8),
            no_price: noAfterFill.toFixed(8),
            volume: tradeValue.toFixed(8),
            trade_count: 1,
            recorded_at: new Date(),
          });

          // Accumulators
          cashRemaining = cashRemaining.minus(cost);
          totalShares = totalShares.plus(fillQty);
          totalTradeValue = totalTradeValue.plus(tradeValue);
          totalUserFee = totalUserFee.plus(userFee);
          totalCost = totalCost.plus(cost);

          // continue sweep
        }

        if (totalShares.lte(EPS)) {
          throw new AppError(ErrorCode.INVALID_TRADE_AMOUNT, 'No enough liquidity to execute market buy', 400);
        }
      } else {
        // action === 'sell': amount is shares to sell
        const qtyToSell = new Decimal(amount);
        // Reserve shares for the taker so upsertPositionFill can safely consume reserved_quantity.
        const position = await trx('positions')
          .where({ user_id: userId, market_id: marketId, side })
          .forUpdate()
          .first();

        const ownedShares = new Decimal(position?.quantity ?? 0);
        const reservedShares = new Decimal(position?.reserved_quantity ?? 0);
        const availableShares = ownedShares.minus(reservedShares);
        if (availableShares.lt(qtyToSell)) {
          throw new AppError(ErrorCode.INSUFFICIENT_SHARES, `Insufficient shares to sell`, 400);
        }

        // Lock taker's shares
        await trx('positions')
          .where({ user_id: userId, market_id: marketId, side })
          .update({
            reserved_quantity: trx.raw('reserved_quantity + ?', [qtyToSell.toFixed(8)]),
            updated_at: new Date(),
          });

        let remainingShares = qtyToSell;

        const makers = await trx('orders')
          .where({ market_id: marketId, side, action: 'buy', type: 'limit' })
          .whereIn('status', ['open', 'partially_filled'])
          .orderBy('price', 'desc')
          .orderBy('created_at', 'asc')
          .forUpdate()
          .select('*');

        for (const maker of makers) {
          if (remainingShares.lte(EPS)) break;
          const makerPrice = new Decimal(maker.price);
          const makerRemaining = new Decimal(maker.remaining_quantity);
          if (makerRemaining.lte(EPS)) continue;

          const fillQty = Decimal.min(remainingShares, makerRemaining);
          if (fillQty.lte(EPS)) continue;

          const tradeValue = fillQty.mul(makerPrice);
          const sellerFee = tradeValue.mul(feeRate);
          const sellerProceeds = tradeValue.minus(sellerFee); // qty*price - fee
          const buyerCost = tradeValue.plus(sellerFee); // qty*price + fee
          const platformFee = buyerCost.minus(sellerProceeds); // 2*fee

          // Update resting maker BUY order state (reserve_cash already exists from its placement)
          const makerFilled = new Decimal(maker.filled_quantity).plus(fillQty);
          const makerRemainingAfter = makerRemaining.minus(fillQty);
          const makerStatus = makerRemainingAfter.lte(EPS) ? 'filled' : 'partially_filled';
          await trx('orders')
            .where('id', maker.id)
            .update({
              filled_quantity: makerFilled.toFixed(8),
              remaining_quantity: makerRemainingAfter.toFixed(8),
              status: makerStatus,
              average_fill_price: makerPrice.toFixed(8),
              updated_at: new Date(),
            });

          // Positions
          await this.upsertPositionFill(trx, maker.user_id, marketId, side, 'buy', fillQty, makerPrice);
          await this.upsertPositionFill(trx, userId, marketId, side, 'sell', fillQty, makerPrice);

          // Cash:
          // - maker buyer pays from reserved_cash (no refund since matchPrice == maker.price)
          const makerBuyerBalance = await trx('balances')
            .where('user_id', maker.user_id)
            .forUpdate()
            .first();
          const makerBuyerResBefore = new Decimal(makerBuyerBalance.reserved_cash ?? makerBuyerBalance.reserved);
          const reservedCashForFill = fillQty.mul(makerPrice).mul(new Decimal(1).plus(feeRate)); // qty*price*(1+feeRate)
          const makerBuyerAvailBefore = new Decimal(makerBuyerBalance.available_cash ?? makerBuyerBalance.available);
          const makerBuyerTotalBefore = makerBuyerAvailBefore.plus(makerBuyerResBefore);

          await trx('balances')
            .where('user_id', maker.user_id)
            .update({
              reserved_cash: trx.raw('reserved_cash - ?', [reservedCashForFill.toFixed(8)]),
              reserved: trx.raw('reserved - ?', [reservedCashForFill.toFixed(8)]),
              total: trx.raw('total - ?', [buyerCost.toFixed(8)]),
              updated_at: new Date(),
            });

          // - taker seller receives proceeds to available_cash
          const sellerBalance = await trx('balances')
            .where('user_id', userId)
            .forUpdate()
            .first();
          const sellerAvailBefore = new Decimal(sellerBalance.available_cash ?? sellerBalance.available);
          const sellerResBefore = new Decimal(sellerBalance.reserved_cash ?? sellerBalance.reserved);
          const sellerTotalBefore = sellerAvailBefore.plus(sellerResBefore);

          await trx('balances')
            .where('user_id', userId)
            .update({
              available_cash: trx.raw('available_cash + ?', [sellerProceeds.toFixed(8)]),
              available: trx.raw('available + ?', [sellerProceeds.toFixed(8)]),
              total: trx.raw('total + ?', [sellerProceeds.toFixed(8)]),
              updated_at: new Date(),
            });

          // - platform fee sink
          if (feeAccount) {
            await trx('balances')
              .where('user_id', feeAccount.id)
              .update({
                available_cash: trx.raw('available_cash + ?', [platformFee.toFixed(8)]),
                available: trx.raw('available + ?', [platformFee.toFixed(8)]),
                total: trx.raw('total + ?', [platformFee.toFixed(8)]),
                updated_at: new Date(),
              });
          }

          // Trade record and balance tx
          const marketNow = await trx('markets').where('id', marketId).first();
          const yesBeforeFill = new Decimal(marketNow.current_yes_price);
          const yesAfterFill = side === 'yes' ? new Decimal(1).minus(makerPrice) : makerPrice; // careful: matchPrice is probability of traded side
          // Actually tradedSide is `side`; for market sell side==yes means yes probability = 1? No.
          // For correctness:
          const tradedSide = side;
          const yesAfter = tradedSide === 'yes' ? makerPrice : new Decimal(1).minus(makerPrice);
          const noAfter = tradedSide === 'yes' ? new Decimal(1).minus(makerPrice) : makerPrice;
          const priceImpact = yesBeforeFill.eq(0) ? new Decimal(0) : yesAfter.minus(yesBeforeFill).abs().div(yesBeforeFill).mul(100);

          const [tradeRow] = await trx('trades')
            .insert({
              market_id: marketId,
              buyer_id: maker.user_id,
              seller_id: userId,
              buyer_order_id: maker.id,
              seller_order_id: null,
              side: tradedSide,
              trade_type: 'order_book',
              price: makerPrice.toFixed(8),
              quantity: fillQty.toFixed(8),
              total_value: tradeValue.toFixed(8),
              fee: platformFee.toFixed(8),
              yes_price_before: yesBeforeFill.toFixed(8),
              yes_price_after: yesAfter.toFixed(8),
              price_impact: priceImpact.toFixed(8),
              executed_at: new Date(),
              metadata: JSON.stringify({ orderBook: true, taker: true }),
            })
            .returning('*');

          const makerBuyerAfter = await trx('balances').where('user_id', maker.user_id).first();
          const makerBuyerTotalAfter = new Decimal(makerBuyerAfter.available_cash ?? makerBuyerAfter.available)
            .plus(new Decimal(makerBuyerAfter.reserved_cash ?? makerBuyerAfter.reserved));
          await trx('balance_transactions').insert({
            user_id: maker.user_id,
            type: 'trade_debit',
            amount: buyerCost.toFixed(8),
            balance_before: makerBuyerTotalBefore.toFixed(8),
            balance_after: makerBuyerTotalAfter.toFixed(8),
            reference_type: 'trade',
            reference_id: tradeRow.id,
            description: `Market fill: bought ${fillQty.toFixed(4)} ${tradedSide.toUpperCase()} @ ${makerPrice.toFixed(4)}`,
          });

          const sellerBalanceAfter = await trx('balances').where('user_id', userId).first();
          const sellerTotalAfter = new Decimal(sellerBalanceAfter.available_cash ?? sellerBalanceAfter.available)
            .plus(new Decimal(sellerBalanceAfter.reserved_cash ?? sellerBalanceAfter.reserved));
          await trx('balance_transactions').insert({
            user_id: userId,
            type: 'trade_credit',
            amount: sellerProceeds.toFixed(8),
            balance_before: sellerTotalBefore.toFixed(8),
            balance_after: sellerTotalAfter.toFixed(8),
            reference_type: 'trade',
            reference_id: tradeRow.id,
            description: `Market fill: sold ${fillQty.toFixed(4)} ${tradedSide.toUpperCase()} @ ${makerPrice.toFixed(4)}`,
          });

          if (feeAccount) {
            const platformAfter = await trx('balances').where('user_id', feeAccount.id).first();
            const platformTotalAfter = new Decimal(platformAfter.available_cash ?? platformAfter.available)
              .plus(new Decimal(platformAfter.reserved_cash ?? platformAfter.reserved));
            await trx('balance_transactions').insert({
              user_id: feeAccount.id,
              type: 'fee',
              amount: platformFee.toFixed(8),
              balance_before: platformTotalAfter.minus(platformFee).toFixed(8),
              balance_after: platformTotalAfter.toFixed(8),
              reference_type: 'trade',
              reference_id: tradeRow.id,
              description: `Platform fee collected for market sell ${tradeRow.id}`,
            });
          }

          await trx('markets')
            .where('id', marketId)
            .update({
              current_yes_price: yesAfter.toFixed(8),
              current_no_price: noAfter.toFixed(8),
              volume_24h: trx.raw('volume_24h + ?', [tradeValue.toFixed(8)]),
              volume_total: trx.raw('volume_total + ?', [tradeValue.toFixed(8)]),
              trade_count: trx.raw('trade_count + 1'),
              updated_at: new Date(),
            });

          await trx('price_history').insert({
            market_id: marketId,
            yes_price: yesAfter.toFixed(8),
            no_price: noAfter.toFixed(8),
            volume: tradeValue.toFixed(8),
            trade_count: 1,
            recorded_at: new Date(),
          });

          // Accumulators
          remainingShares = remainingShares.minus(fillQty);
          totalShares = totalShares.plus(fillQty);
          totalTradeValue = totalTradeValue.plus(tradeValue);
          totalUserFee = totalUserFee.plus(sellerFee);
          totalCost = totalCost.plus(sellerProceeds);
        }

        // Unreserve any leftover (partial fill)
        const unfilled = qtyToSell.minus(totalShares);
        if (unfilled.gt(EPS)) {
          await trx('positions')
            .where({ user_id: userId, market_id: marketId, side })
            .update({
              reserved_quantity: trx.raw('reserved_quantity - ?', [unfilled.toFixed(8)]),
              updated_at: new Date(),
            });
        }

        if (totalShares.lte(EPS)) {
          throw new AppError(ErrorCode.INVALID_TRADE_AMOUNT, 'No enough liquidity to execute market sell', 400);
        }
      }

      const averagePrice = totalTradeValue.div(totalShares);
      const yesAfter = tradedSide === 'yes' ? averagePrice : new Decimal(1).minus(averagePrice);
      const priceImpact = yesBefore.eq(0) ? new Decimal(0) : yesAfter.minus(yesBefore).abs().div(yesBefore).mul(100);

      // Slippage guard (compares selected-side avg price)
      if (expectedPrice !== undefined) {
        if (!new Decimal(expectedPrice).eq(0)) {
          const diffPct = new Decimal(averagePrice).minus(expectedPrice).abs().div(expectedPrice).mul(100);
          if (diffPct.gt(maxSlippage)) {
            throw new SlippageExceededError(expectedPrice, averagePrice.toNumber(), maxSlippage);
          }
        }
      }

      const userBalance = await trx('balances').where('user_id', userId).forUpdate().first();
      const newBalance = new Decimal(userBalance.available_cash ?? userBalance.available).toNumber();

      const tradeId = (await trx('trades')
        .where({ market_id: marketId })
        .orderBy('executed_at', 'desc')
        .limit(1)
        .first()).id as string;

      return {
        tradeId,
        sharesTransacted: totalShares.toNumber(),
        totalCost: totalCost.toNumber(),
        averagePrice: averagePrice.toNumber(),
        priceImpact: priceImpact.toNumber(),
        yesPriceBefore: yesBefore.toNumber(),
        yesPriceAfter: yesAfter.toNumber(),
        fee: totalUserFee.toNumber(),
        newBalance,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // MARKET RESOLUTION
  // ─────────────────────────────────────────────────────────────────
  async resolveMarket(
    marketId: string,
    outcome: 'yes' | 'no' | 'invalid',
    resolvedBy: string,
    note?: string
  ): Promise<{ totalPayouts: number; winnersCount: number }> {
    return withTransaction(async (trx) => {
      const market = await trx('markets').where('id', marketId).forUpdate().first();
      if (!market) throw new AppError(ErrorCode.MARKET_NOT_FOUND, 'Market not found', 404);
      if (market.status === 'resolved') {
        throw new AppError(ErrorCode.MARKET_ALREADY_RESOLVED, 'Market already resolved', 400);
      }
      if (!['active', 'paused', 'expired', 'cancelled'].includes(market.status)) {
        throw new AppError(ErrorCode.INVALID_MARKET_STATUS, `Cannot resolve market in status: ${market.status}`, 400);
      }

      // 1) Cancel open orders and release reserved resources
      const openOrders = await trx('orders')
        .where({ market_id: marketId })
        .whereIn('status', ['open', 'partially_filled'])
        .forUpdate()
        .select('*');

      for (const order of openOrders) {
        const remainingQty = new Decimal(order.remaining_quantity);

        if (order.action === 'buy') {
          // release reserved_cash: remaining_qty * limitPrice * (1 + feeRate)
          const remainingCost = remainingQty.mul(new Decimal(order.price));
          const feeOnRemaining = remainingCost.mul(this.FEE_RATE);
          const refundCash = remainingCost.plus(feeOnRemaining);

          await trx('balances')
            .where('user_id', order.user_id)
            .update({
              available_cash: trx.raw('available_cash + ?', [refundCash.toFixed(8)]),
              reserved_cash: trx.raw('reserved_cash - ?', [refundCash.toFixed(8)]),
              available: trx.raw('available + ?', [refundCash.toFixed(8)]),
              reserved: trx.raw('reserved - ?', [refundCash.toFixed(8)]),
              updated_at: new Date(),
            });
        } else {
          // release reserved_shares
          await trx('positions')
            .where({ user_id: order.user_id, market_id: marketId, side: order.side })
            .update({
              reserved_quantity: trx.raw('reserved_quantity - ?', [remainingQty.toFixed(8)]),
              updated_at: new Date(),
            });
        }

        await trx('orders')
          .where('id', order.id)
          .update({
            status: 'cancelled',
            cancel_reason: 'Market resolved',
            updated_at: new Date(),
          });
      }

      // 2) Set market outcome
      await trx('markets').where('id', marketId).update({
        status: 'resolved',
        outcome,
        resolved_at: new Date(),
        resolved_by: resolvedBy,
        resolution_note: note,
        updated_at: new Date(),
      });

      // 3) Pay winners / refund on invalid
      let totalPayouts = new Decimal(0);
      let winnersCount = 0;

      // Resolution cash source:
      // - market collateral pool (liquidity_total) built during complementary BUY↔BUY minting
      // - platform fee/surplus sink only as a fallback
      let poolRemaining = new Decimal(market.liquidity_total ?? 0);

      const feeAccount = await this.getFeeAccount(trx);
      let feeAvailableRemaining = new Decimal(0);
      let feeTotalRemaining = new Decimal(0);
      if (feeAccount) {
        const feeBalance = await trx('balances')
          .where('user_id', feeAccount.id)
          .forUpdate()
          .first();
        feeAvailableRemaining = new Decimal(feeBalance?.available_cash ?? feeBalance?.available ?? 0);
        const feeReservedRemaining = new Decimal(feeBalance?.reserved_cash ?? feeBalance?.reserved ?? 0);
        feeTotalRemaining = feeAvailableRemaining.plus(feeReservedRemaining);
      }

      const positions = await trx('positions')
        .where({ market_id: marketId })
        .where('quantity', '>', 0)
        .forUpdate()
        .select('*');

      // INVALID settlement:
      // - refund each user their net cashflow in this market:
      //   net_spend = sum(principal paid) - sum(principal received), where principal == trades.total_value
      // - refund only if net_spend > 0 (variant B)
      // - trade fees are excluded by construction (we do not use trades.fee)
      let invalidRefundsByUser: Map<string, Decimal> | null = null;
      if (outcome === 'invalid') {
        invalidRefundsByUser = new Map();

        const buyerRows = await trx('trades')
          .where({ market_id: marketId })
          .groupBy('buyer_id')
          .select('buyer_id')
          .select(trx.raw('SUM(total_value) as principal_paid'));

        for (const r of buyerRows) {
          const userId = r.buyer_id as string;
          const principalPaid = new Decimal(r.principal_paid ?? 0);
          invalidRefundsByUser.set(userId, principalPaid);
        }

        const sellerRows = await trx('trades')
          .where({ market_id: marketId })
          .groupBy('seller_id')
          .select('seller_id')
          .select(trx.raw('SUM(total_value) as principal_received'));

        for (const r of sellerRows) {
          const userId = r.seller_id as string;
          const principalReceived = new Decimal(r.principal_received ?? 0);
          const prev = invalidRefundsByUser.get(userId) ?? new Decimal(0);
          invalidRefundsByUser.set(userId, prev.minus(principalReceived));
        }

        // Keep only positive net_spend refunds
        for (const [userId, netSpend] of invalidRefundsByUser.entries()) {
          if (!netSpend.gt(0)) invalidRefundsByUser.delete(userId);
          else invalidRefundsByUser.set(userId, netSpend);
        }
      }

      for (const pos of positions) {
        const qty = new Decimal(pos.quantity);

        // Reset positions after resolution
        await trx('positions')
          .where({ id: pos.id })
          .update({
            quantity: '0',
            reserved_quantity: '0',
            average_price: '0',
            total_invested: '0',
            realized_pnl: '0',
            unrealized_pnl: '0',
            updated_at: new Date(),
          });

        if (outcome === 'invalid') {
          continue;
        }

        if (pos.side === outcome) {
          const payout = qty; // 1.0 per winning share

          const fromPool = Decimal.min(poolRemaining, payout);
          const fromFee = payout.minus(fromPool);
          poolRemaining = poolRemaining.minus(fromPool);

          if (fromFee.gt(0)) {
            if (!feeAccount) throw new AppError(ErrorCode.INTERNAL_ERROR, 'Missing fee sink for payout', 500);
            const balanceBefore = feeTotalRemaining;
            const balanceAfter = balanceBefore.minus(fromFee);
            await trx('balances')
              .where('user_id', feeAccount.id)
              .update({
                available_cash: trx.raw('available_cash - ?', [fromFee.toFixed(8)]),
                available: trx.raw('available - ?', [fromFee.toFixed(8)]),
                total: trx.raw('total - ?', [fromFee.toFixed(8)]),
                updated_at: new Date(),
              });
            await trx('balance_transactions').insert({
              user_id: feeAccount.id,
              type: 'trade_debit',
              amount: fromFee.toFixed(8),
              balance_before: balanceBefore.toFixed(8),
              balance_after: balanceAfter.toFixed(8),
              reference_type: 'market_resolution',
              reference_id: marketId,
              description: `Market resolved ${outcome.toUpperCase()} — fee sink debited`,
            });
            feeAvailableRemaining = feeAvailableRemaining.minus(fromFee);
            feeTotalRemaining = balanceAfter;
          }

          const balance = await trx('balances')
            .where('user_id', pos.user_id)
            .forUpdate()
            .first();
          const availBefore = new Decimal(balance.available_cash ?? balance.available);

          await trx('balances')
            .where('user_id', pos.user_id)
            .update({
              available_cash: trx.raw('available_cash + ?', [payout.toFixed(8)]),
              available: trx.raw('available + ?', [payout.toFixed(8)]),
              total: trx.raw('total + ?', [payout.toFixed(8)]),
              updated_at: new Date(),
            });

          winnersCount++;
          totalPayouts = totalPayouts.plus(payout);

          await trx('balance_transactions').insert({
            user_id: pos.user_id,
            type: 'trade_credit',
            amount: payout.toFixed(8),
            balance_before: availBefore.toFixed(8),
            balance_after: availBefore.plus(payout).toFixed(8),
            reference_type: 'market_resolution',
            reference_id: marketId,
            description: `Market resolved ${outcome.toUpperCase()} — payout for ${qty.toFixed(4)} shares`,
          });
        }
      }

      if (outcome === 'invalid' && invalidRefundsByUser) {
        for (const [userId, refund] of invalidRefundsByUser.entries()) {
          const fromPool = Decimal.min(poolRemaining, refund);
          const fromFee = refund.minus(fromPool);
          poolRemaining = poolRemaining.minus(fromPool);

          if (fromFee.gt(0)) {
            if (!feeAccount) throw new AppError(ErrorCode.INTERNAL_ERROR, 'Missing fee sink for invalid refund', 500);
            const balanceBefore = feeTotalRemaining;
            const balanceAfter = balanceBefore.minus(fromFee);
            await trx('balances')
              .where('user_id', feeAccount.id)
              .update({
                available_cash: trx.raw('available_cash - ?', [fromFee.toFixed(8)]),
                available: trx.raw('available - ?', [fromFee.toFixed(8)]),
                total: trx.raw('total - ?', [fromFee.toFixed(8)]),
                updated_at: new Date(),
              });
            await trx('balance_transactions').insert({
              user_id: feeAccount.id,
              type: 'trade_debit',
              amount: fromFee.toFixed(8),
              balance_before: balanceBefore.toFixed(8),
              balance_after: balanceAfter.toFixed(8),
              reference_type: 'market_resolution',
              reference_id: marketId,
              description: `Market resolved ${outcome.toUpperCase()} — fee sink debited (INVALID refund)`,
            });
            feeAvailableRemaining = feeAvailableRemaining.minus(fromFee);
            feeTotalRemaining = balanceAfter;
          }

          const balance = await trx('balances')
            .where('user_id', userId)
            .forUpdate()
            .first();
          const availBefore = new Decimal(balance.available_cash ?? balance.available);

          await trx('balances')
            .where('user_id', userId)
            .update({
              available_cash: trx.raw('available_cash + ?', [refund.toFixed(8)]),
              available: trx.raw('available + ?', [refund.toFixed(8)]),
              total: trx.raw('total + ?', [refund.toFixed(8)]),
              updated_at: new Date(),
            });

          totalPayouts = totalPayouts.plus(refund);
          winnersCount++;
          await trx('balance_transactions').insert({
            user_id: userId,
            type: 'refund',
            amount: refund.toFixed(8),
            balance_before: availBefore.toFixed(8),
            balance_after: availBefore.plus(refund).toFixed(8),
            reference_type: 'market_resolution',
            reference_id: marketId,
            description: `Market resolved as INVALID — refund net_spend for user ${userId}`,
          });
        }
      }

      await trx('markets')
        .where('id', marketId)
        .update({
          liquidity_total: Decimal.max(0, poolRemaining).toFixed(8),
          yes_shares: '0',
          no_shares: '0',
          updated_at: new Date(),
        });

      return {
        totalPayouts: totalPayouts.toNumber(),
        winnersCount,
      };
    });
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

      const remainingQty = new Decimal(order.remaining_quantity);

      // Refund reserved resources
      if (order.action === 'buy') {
        // Release reserved_cash for remaining portion:
        // reserved_cash = remaining_qty * limitPrice * (1 + fee_rate)
        const remainingCost = remainingQty.mul(new Decimal(order.price));
        const feeOnRemaining = remainingCost.mul(this.FEE_RATE);
        const refundCash = remainingCost.plus(feeOnRemaining);

        if (refundCash.gt(0)) {
          const balance = await trx('balances')
            .where('user_id', userId)
            .forUpdate()
            .first();

          const availBefore = new Decimal(balance.available_cash ?? balance.available);
          const resBefore = new Decimal(balance.reserved_cash ?? balance.reserved);
          const totalBefore = availBefore.plus(resBefore);

          await trx('balances')
            .where('user_id', userId)
            .update({
              available_cash: trx.raw('available_cash + ?', [refundCash.toFixed(8)]),
              reserved_cash: trx.raw('reserved_cash - ?', [refundCash.toFixed(8)]),
              available: trx.raw('available + ?', [refundCash.toFixed(8)]),
              reserved: trx.raw('reserved - ?', [refundCash.toFixed(8)]),
              updated_at: new Date(),
            });

          const totalAfter = totalBefore.plus(refundCash);

          await trx('balance_transactions').insert({
            user_id: userId,
            type: 'refund',
            amount: refundCash.toFixed(8),
            balance_before: totalBefore.toFixed(8),
            balance_after: totalAfter.toFixed(8),
            reference_type: 'order',
            reference_id: orderId,
            description: 'Order cancelled — reserved cash released',
          });
        }
      } else {
        // SELL cancel: release reserved_shares only (positions.quantity must stay intact).
        await trx('positions')
          .where({ user_id: userId, market_id: order.market_id, side: order.side })
          .update({
            reserved_quantity: trx.raw('reserved_quantity - ?', [remainingQty.toFixed(8)]),
            updated_at: new Date(),
          });
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
