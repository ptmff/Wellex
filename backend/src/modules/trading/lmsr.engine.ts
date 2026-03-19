/**
 * LMSR (Logarithmic Market Scoring Rule) Trading Engine
 *
 * Core formula:
 *   C(q) = b * ln(exp(q_yes/b) + exp(q_no/b))
 *
 * Price of YES:
 *   P(yes) = exp(q_yes/b) / (exp(q_yes/b) + exp(q_no/b))
 *
 * Cost to buy Δq YES shares:
 *   cost = C(q_yes + Δq, q_no) - C(q_yes, q_no)
 */

import Decimal from 'decimal.js';
import { db, withTransaction } from '../../database/connection';
import { CacheService, priceCache } from '../../infrastructure/redis/cache.service';
import {
  AppError,
  ErrorCode,
  InsufficientBalanceError,
  SlippageExceededError,
} from '../../common/errors';
import { logger } from '../../common/logger';
import { config } from '../../config';
import { WebSocketService } from '../../infrastructure/websocket/ws.service';
import { ActivityService } from '../activity/activity.service';

// Precision settings
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface TradeParams {
  userId: string;
  marketId: string;
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  amount: number;           // In USD (for buy) or shares (for sell)
  maxSlippage?: number;     // Percentage, e.g. 2 = 2%
  expectedPrice?: number;   // For slippage check
}

export interface TradeResult {
  tradeId: string;
  marketId: string;
  userId: string;
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  sharesTransacted: number;
  totalCost: number;
  averagePrice: number;
  priceImpact: number;
  yesPriceBefore: number;
  yesPriceAfter: number;
  fee: number;
  newBalance: number;
}

export interface MarketPrices {
  yesPrice: number;
  noPrice: number;
  yesShares: number;
  noShares: number;
  liquidityB: number;
}

// Trading fee: 0.5%
const TRADE_FEE_RATE = new Decimal('0.005');

export class LMSREngine {
  private readonly wsService: WebSocketService;
  private readonly activityService: ActivityService;

  constructor(wsService: WebSocketService, activityService: ActivityService) {
    this.wsService = wsService;
    this.activityService = activityService;
  }

  // ─────────────────────────────────────────────────────────────────
  // LMSR MATH
  // ─────────────────────────────────────────────────────────────────

  /**
   * Cost function: C(q_yes, q_no) = b * ln(exp(q_yes/b) + exp(q_no/b))
   * Uses log-sum-exp trick for numerical stability
   */
  private costFunction(qYes: Decimal, qNo: Decimal, b: Decimal): Decimal {
    const yesExp = qYes.div(b);
    const noExp = qNo.div(b);

    // Log-sum-exp: max + ln(exp(a-max) + exp(b-max))
    const maxExp = Decimal.max(yesExp, noExp);
    const lse = maxExp.plus(
      Decimal.ln(
        Decimal.exp(yesExp.minus(maxExp)).plus(Decimal.exp(noExp.minus(maxExp)))
      )
    );

    return b.mul(lse);
  }

  /**
   * Price of YES share = exp(q_yes/b) / (exp(q_yes/b) + exp(q_no/b))
   */
  calcYesPrice(qYes: Decimal, qNo: Decimal, b: Decimal): Decimal {
    const yesExp = qYes.div(b);
    const noExp = qNo.div(b);

    // Numerically stable sigmoid-like calculation
    const maxExp = Decimal.max(yesExp, noExp);
    const yesExpNorm = Decimal.exp(yesExp.minus(maxExp));
    const noExpNorm = Decimal.exp(noExp.minus(maxExp));
    const total = yesExpNorm.plus(noExpNorm);

    return yesExpNorm.div(total);
  }

  /**
   * Calculate cost to buy/sell delta shares
   * Positive delta = buy, negative delta = sell
   */
  calcTradeCost(
    qYes: Decimal,
    qNo: Decimal,
    b: Decimal,
    side: 'yes' | 'no',
    delta: Decimal
  ): Decimal {
    const costBefore = this.costFunction(qYes, qNo, b);

    let costAfter: Decimal;
    if (side === 'yes') {
      costAfter = this.costFunction(qYes.plus(delta), qNo, b);
    } else {
      costAfter = this.costFunction(qYes, qNo.plus(delta), b);
    }

    return costAfter.minus(costBefore);
  }

  /**
   * Given a budget (USD amount), calculate how many shares you can buy
   * Uses binary search for numerical precision
   */
  calcSharesForBudget(
    qYes: Decimal,
    qNo: Decimal,
    b: Decimal,
    side: 'yes' | 'no',
    budget: Decimal
  ): Decimal {
    // Binary search between 0 and max possible shares
    let low = new Decimal(0);
    let high = budget.mul(100); // Upper bound

    for (let i = 0; i < 64; i++) {
      const mid = low.plus(high).div(2);
      const cost = this.calcTradeCost(qYes, qNo, b, side, mid);

      if (cost.lt(budget)) {
        low = mid;
      } else {
        high = mid;
      }

      if (high.minus(low).lt('0.000001')) break;
    }

    return low;
  }

  /**
   * Calculate shares to sell to receive a given USD amount
   */
  calcSharesForReturn(
    qYes: Decimal,
    qNo: Decimal,
    b: Decimal,
    side: 'yes' | 'no',
    targetReturn: Decimal
  ): Decimal {
    let low = new Decimal(0);
    let high = side === 'yes' ? qYes : qNo;

    for (let i = 0; i < 64; i++) {
      const mid = low.plus(high).div(2);
      // Selling = negative delta cost
      const returnAmount = this.calcTradeCost(qYes, qNo, b, side, mid.neg()).neg();

      if (returnAmount.lt(targetReturn)) {
        low = mid;
      } else {
        high = mid;
      }

      if (high.minus(low).lt('0.000001')) break;
    }

    return low;
  }

  // ─────────────────────────────────────────────────────────────────
  // TRADE EXECUTION
  // ─────────────────────────────────────────────────────────────────

  async executeTrade(params: TradeParams): Promise<TradeResult> {
    const { userId, marketId, side, action, amount, maxSlippage = 5, expectedPrice } = params;

    // Validate amount
    if (amount < config.MIN_TRADE_AMOUNT) {
      throw new AppError(
        ErrorCode.MIN_TRADE_AMOUNT,
        `Minimum trade amount is ${config.MIN_TRADE_AMOUNT}`,
        400
      );
    }
    if (amount > config.MAX_TRADE_AMOUNT) {
      throw new AppError(
        ErrorCode.MAX_TRADE_AMOUNT,
        `Maximum trade amount is ${config.MAX_TRADE_AMOUNT}`,
        400
      );
    }

    return withTransaction(async (trx) => {
      // ── 1. Lock market row (SELECT FOR UPDATE)
      const market = await trx('markets')
        .where('id', marketId)
        .forUpdate()
        .first();

      if (!market) {
        throw new AppError(ErrorCode.MARKET_NOT_FOUND, 'Market not found', 404);
      }
      if (market.status !== 'active') {
        throw new AppError(ErrorCode.MARKET_INACTIVE, `Market is ${market.status}`, 400);
      }
      if (new Date(market.closes_at) <= new Date()) {
        throw new AppError(ErrorCode.MARKET_CLOSED, 'Market has closed', 400);
      }

      const b = new Decimal(market.liquidity_b);
      const qYes = new Decimal(market.yes_shares);
      const qNo = new Decimal(market.no_shares);

      const yesPriceBefore = this.calcYesPrice(qYes, qNo, b);

      // ── 2. Calculate trade
      let sharesDecimal: Decimal;
      let costDecimal: Decimal;

      if (action === 'buy') {
        // Budget in USD -> shares
        const budgetBeforeFee = new Decimal(amount);
        const fee = budgetBeforeFee.mul(TRADE_FEE_RATE);
        const budget = budgetBeforeFee.minus(fee);

        sharesDecimal = this.calcSharesForBudget(qYes, qNo, b, side, budget);
        costDecimal = budgetBeforeFee; // User pays full amount

        // Validate we got meaningful shares
        if (sharesDecimal.lt('0.000001')) {
          throw new AppError(ErrorCode.INVALID_TRADE_AMOUNT, 'Trade amount too small', 400);
        }
      } else {
        // Sell: amount = shares to sell
        const sharesToSell = new Decimal(amount);

        // Check user has enough shares
        const position = await trx('positions')
          .where({ user_id: userId, market_id: marketId, side })
          .first();

        const currentShares = new Decimal(position?.quantity ?? 0);
        if (currentShares.lt(sharesToSell)) {
          throw new AppError(
            ErrorCode.INSUFFICIENT_SHARES,
            `Insufficient shares: have ${currentShares.toFixed(6)}, need ${sharesToSell.toFixed(6)}`,
            400
          );
        }

        sharesDecimal = sharesToSell;
        const rawReturn = this.calcTradeCost(qYes, qNo, b, side, sharesToSell.neg()).neg();
        const fee = rawReturn.mul(TRADE_FEE_RATE);
        costDecimal = rawReturn.minus(fee).neg(); // negative = user receives money
      }

      const feeDecimal = new Decimal(amount).mul(TRADE_FEE_RATE);
      const averagePrice = action === 'buy'
        ? costDecimal.div(sharesDecimal)
        : costDecimal.neg().div(sharesDecimal);

      // ── 3. Slippage check
      const currentPrice = side === 'yes' ? yesPriceBefore : new Decimal(1).minus(yesPriceBefore);

      if (expectedPrice !== undefined) {
        const priceDiff = averagePrice.minus(expectedPrice).abs();
        const slippagePct = priceDiff.div(expectedPrice).mul(100);

        if (slippagePct.gt(maxSlippage)) {
          throw new SlippageExceededError(
            expectedPrice,
            averagePrice.toNumber(),
            maxSlippage
          );
        }
      }

      // ── 4. Lock and update balance (optimistic locking)
      const balance = await trx('balances')
        .where('user_id', userId)
        .forUpdate()
        .first();

      if (!balance) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Balance not found', 404);
      }

      const availableBalance = new Decimal(balance.available);
      const balanceBefore = availableBalance;

      if (action === 'buy') {
        if (availableBalance.lt(costDecimal)) {
          throw new InsufficientBalanceError(
            availableBalance.toNumber(),
            costDecimal.toNumber()
          );
        }
      }

      // ── 5. Update shares (LMSR state)
      let newQYes = qYes;
      let newQNo = qNo;

      if (side === 'yes') {
        newQYes = action === 'buy' ? qYes.plus(sharesDecimal) : qYes.minus(sharesDecimal);
      } else {
        newQNo = action === 'buy' ? qNo.plus(sharesDecimal) : qNo.minus(sharesDecimal);
      }

      const yesPriceAfter = this.calcYesPrice(newQYes, newQNo, b);
      const priceImpact = yesPriceAfter.minus(yesPriceBefore).abs().div(yesPriceBefore).mul(100);

      // ── 6. Persist trade
      const [trade] = await trx('trades').insert({
        market_id: marketId,
        buyer_id: action === 'buy' ? userId : userId, // simplified for AMM
        side,
        trade_type: 'amm',
        price: averagePrice.toFixed(8),
        quantity: sharesDecimal.toFixed(8),
        total_value: costDecimal.abs().toFixed(8),
        fee: feeDecimal.toFixed(8),
        yes_price_before: yesPriceBefore.toFixed(8),
        yes_price_after: yesPriceAfter.toFixed(8),
        price_impact: priceImpact.toFixed(8),
        executed_at: new Date(),
        metadata: JSON.stringify({ action }),
      }).returning('*');

      // ── 7. Update market state
      const volumeChange = costDecimal.abs();
      await trx('markets')
        .where('id', marketId)
        .increment('version', 1)
        .update({
          yes_shares: newQYes.toFixed(8),
          no_shares: newQNo.toFixed(8),
          current_yes_price: yesPriceAfter.toFixed(8),
          current_no_price: new Decimal(1).minus(yesPriceAfter).toFixed(8),
          volume_24h: trx.raw('volume_24h + ?', [volumeChange.toFixed(8)]),
          volume_total: trx.raw('volume_total + ?', [volumeChange.toFixed(8)]),
          trade_count: trx.raw('trade_count + 1'),
          updated_at: new Date(),
        });

      // ── 8. Update balance
      const balanceChange = action === 'buy'
        ? costDecimal.neg()
        : costDecimal.abs();
      const newBalance = availableBalance.plus(balanceChange);

      await trx('balances')
        .where('user_id', userId)
        .increment('version', 1)
        .update({
          available: newBalance.toFixed(8),
          total: trx.raw('total + ?', [balanceChange.toFixed(8)]),
          updated_at: new Date(),
        });

      // Balance transaction log
      await trx('balance_transactions').insert({
        user_id: userId,
        type: action === 'buy' ? 'trade_debit' : 'trade_credit',
        amount: balanceChange.abs().toFixed(8),
        balance_before: balanceBefore.toFixed(8),
        balance_after: newBalance.toFixed(8),
        reference_type: 'trade',
        reference_id: trade.id,
        description: `${action} ${sharesDecimal.toFixed(4)} ${side.toUpperCase()} shares`,
        metadata: JSON.stringify({ marketId, side, action }),
      });

      // ── 9. Update or create position
      await this.upsertPosition(
        trx,
        userId,
        marketId,
        side,
        action,
        sharesDecimal,
        averagePrice,
        costDecimal.abs()
      );

      // ── 10. Record price history
      await trx('price_history').insert({
        market_id: marketId,
        yes_price: yesPriceAfter.toFixed(8),
        no_price: new Decimal(1).minus(yesPriceAfter).toFixed(8),
        volume: volumeChange.toFixed(8),
        trade_count: 1,
        recorded_at: new Date(),
      });

      const result: TradeResult = {
        tradeId: trade.id,
        marketId,
        userId,
        side,
        action,
        sharesTransacted: sharesDecimal.toNumber(),
        totalCost: costDecimal.abs().toNumber(),
        averagePrice: averagePrice.toNumber(),
        priceImpact: priceImpact.toNumber(),
        yesPriceBefore: yesPriceBefore.toNumber(),
        yesPriceAfter: yesPriceAfter.toNumber(),
        fee: feeDecimal.toNumber(),
        newBalance: newBalance.toNumber(),
      };

      // ── 11. Async side effects (after commit)
      setImmediate(async () => {
        try {
          // Invalidate caches
          await priceCache.del(`market:${marketId}`);
          await priceCache.del(`prices:${marketId}`);

          // Broadcast via WebSocket
          await this.wsService.broadcastToMarket(marketId, 'trade', {
            marketId,
            side,
            action,
            price: yesPriceAfter.toNumber(),
            quantity: sharesDecimal.toNumber(),
            totalValue: costDecimal.abs().toNumber(),
            timestamp: new Date().toISOString(),
          });

          await this.wsService.broadcastToMarket(marketId, 'price_update', {
            marketId,
            yesPrice: yesPriceAfter.toNumber(),
            noPrice: new Decimal(1).minus(yesPriceAfter).toNumber(),
            timestamp: new Date().toISOString(),
          });

          // Activity feed
          await this.activityService.record({
            userId,
            marketId,
            type: 'trade',
            data: {
              side,
              action,
              shares: sharesDecimal.toNumber(),
              price: averagePrice.toNumber(),
              totalCost: costDecimal.abs().toNumber(),
            },
          });

          logger.info('Trade executed', {
            tradeId: trade.id,
            userId,
            marketId,
            side,
            action,
            shares: sharesDecimal.toFixed(4),
            cost: costDecimal.abs().toFixed(2),
            priceImpact: priceImpact.toFixed(4),
          });
        } catch (sideEffectErr) {
          logger.error('Trade side effects failed', {
            tradeId: trade.id,
            error: (sideEffectErr as Error).message,
          });
        }
      });

      return result;
    });
  }

  private async upsertPosition(
    trx: any,
    userId: string,
    marketId: string,
    side: 'yes' | 'no',
    action: 'buy' | 'sell',
    shares: Decimal,
    price: Decimal,
    cost: Decimal
  ): Promise<void> {
    const existing = await trx('positions')
      .where({ user_id: userId, market_id: marketId, side })
      .first();

    if (!existing) {
      if (action === 'buy') {
        await trx('positions').insert({
          user_id: userId,
          market_id: marketId,
          side,
          quantity: shares.toFixed(8),
          average_price: price.toFixed(8),
          total_invested: cost.toFixed(8),
          trade_count: 1,
          last_trade_at: new Date(),
        });
      }
      return;
    }

    const currentQty = new Decimal(existing.quantity);
    const currentAvgPrice = new Decimal(existing.average_price);
    const currentInvested = new Decimal(existing.total_invested);

    if (action === 'buy') {
      // Weighted average price
      const newQty = currentQty.plus(shares);
      const newInvested = currentInvested.plus(cost);
      const newAvgPrice = newInvested.div(newQty);

      await trx('positions')
        .where({ user_id: userId, market_id: marketId, side })
        .increment('version', 1)
        .update({
          quantity: newQty.toFixed(8),
          average_price: newAvgPrice.toFixed(8),
          total_invested: newInvested.toFixed(8),
          trade_count: trx.raw('trade_count + 1'),
          last_trade_at: new Date(),
          updated_at: new Date(),
        });
    } else {
      // Sell: calculate realized PnL
      const newQty = currentQty.minus(shares);
      const costBasis = currentAvgPrice.mul(shares);
      const saleProceeds = price.mul(shares);
      const realizedPnl = saleProceeds.minus(costBasis);

      if (newQty.lte(0)) {
        // Full position close
        await trx('positions')
          .where({ user_id: userId, market_id: marketId, side })
          .update({
            quantity: '0',
            realized_pnl: trx.raw('realized_pnl + ?', [realizedPnl.toFixed(8)]),
            trade_count: trx.raw('trade_count + 1'),
            last_trade_at: new Date(),
            updated_at: new Date(),
          });
      } else {
        // Partial close
        const newInvested = currentAvgPrice.mul(newQty);
        await trx('positions')
          .where({ user_id: userId, market_id: marketId, side })
          .update({
            quantity: newQty.toFixed(8),
            total_invested: newInvested.toFixed(8),
            realized_pnl: trx.raw('realized_pnl + ?', [realizedPnl.toFixed(8)]),
            trade_count: trx.raw('trade_count + 1'),
            last_trade_at: new Date(),
            updated_at: new Date(),
          });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // PRICE QUOTES (no state changes)
  // ─────────────────────────────────────────────────────────────────

  async getQuote(
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

    if (!market) {
      throw new AppError(ErrorCode.MARKET_NOT_FOUND, 'Market not found', 404);
    }

    const b = new Decimal(market.liquidity_b);
    const qYes = new Decimal(market.yes_shares);
    const qNo = new Decimal(market.no_shares);
    const yesPriceCurrent = this.calcYesPrice(qYes, qNo, b);

    let sharesDecimal: Decimal;
    let totalCostDecimal: Decimal;

    if (action === 'buy') {
      const budgetBeforeFee = new Decimal(amount);
      const fee = budgetBeforeFee.mul(TRADE_FEE_RATE);
      const budget = budgetBeforeFee.minus(fee);
      sharesDecimal = this.calcSharesForBudget(qYes, qNo, b, side, budget);
      totalCostDecimal = budgetBeforeFee;
    } else {
      sharesDecimal = new Decimal(amount);
      const rawReturn = this.calcTradeCost(qYes, qNo, b, side, sharesDecimal.neg()).neg();
      const fee = rawReturn.mul(TRADE_FEE_RATE);
      totalCostDecimal = rawReturn.minus(fee);
    }

    const feeDecimal = new Decimal(amount).mul(TRADE_FEE_RATE);
    const avgPrice = action === 'buy'
      ? totalCostDecimal.div(sharesDecimal)
      : totalCostDecimal.div(sharesDecimal);

    let newQYes = qYes;
    let newQNo = qNo;
    if (side === 'yes') {
      newQYes = action === 'buy' ? qYes.plus(sharesDecimal) : qYes.minus(sharesDecimal);
    } else {
      newQNo = action === 'buy' ? qNo.plus(sharesDecimal) : qNo.minus(sharesDecimal);
    }

    const yesPriceAfter = this.calcYesPrice(newQYes, newQNo, b);
    const priceImpact = yesPriceAfter.minus(yesPriceCurrent).abs().div(yesPriceCurrent).mul(100);

    return {
      shares: sharesDecimal.toNumber(),
      totalCost: totalCostDecimal.toNumber(),
      averagePrice: avgPrice.toNumber(),
      priceImpact: priceImpact.toNumber(),
      fee: feeDecimal.toNumber(),
      priceAfter: side === 'yes' ? yesPriceAfter.toNumber() : new Decimal(1).minus(yesPriceAfter).toNumber(),
    };
  }

  // Calculate market resolution payouts
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
      if (!['active', 'paused', 'expired'].includes(market.status)) {
        throw new AppError(ErrorCode.INVALID_MARKET_STATUS, `Cannot resolve market in status: ${market.status}`, 400);
      }

      // Update market
      await trx('markets').where('id', marketId).update({
        status: 'resolved',
        outcome,
        resolved_at: new Date(),
        resolved_by: resolvedBy,
        resolution_note: note,
        updated_at: new Date(),
      });

      let totalPayouts = new Decimal(0);
      let winnersCount = 0;

      if (outcome === 'invalid') {
        // Refund everyone proportionally
        const positions = await trx('positions')
          .where({ market_id: marketId })
          .where('quantity', '>', 0);

        for (const pos of positions) {
          const refundAmount = new Decimal(pos.total_invested);
          if (refundAmount.lte(0)) continue;

          const balance = await trx('balances')
            .where('user_id', pos.user_id)
            .forUpdate()
            .first();

          const balanceBefore = new Decimal(balance.available);
          const balanceAfter = balanceBefore.plus(refundAmount);

          await trx('balances').where('user_id', pos.user_id).update({
            available: balanceAfter.toFixed(8),
            total: trx.raw('total + ?', [refundAmount.toFixed(8)]),
            updated_at: new Date(),
          });

          await trx('balance_transactions').insert({
            user_id: pos.user_id,
            type: 'refund',
            amount: refundAmount.toFixed(8),
            balance_before: balanceBefore.toFixed(8),
            balance_after: balanceAfter.toFixed(8),
            reference_type: 'market_resolution',
            reference_id: marketId,
            description: 'Market resolved as invalid - refund',
          });

          totalPayouts = totalPayouts.plus(refundAmount);
          winnersCount++;
        }
      } else {
        // Pay winners 1.0 per winning share
        const winningPositions = await trx('positions')
          .where({ market_id: marketId, side: outcome })
          .where('quantity', '>', 0);

        for (const pos of winningPositions) {
          const payout = new Decimal(pos.quantity); // 1.0 per share

          const balance = await trx('balances')
            .where('user_id', pos.user_id)
            .forUpdate()
            .first();

          const balanceBefore = new Decimal(balance.available);
          const balanceAfter = balanceBefore.plus(payout);

          await trx('balances').where('user_id', pos.user_id).update({
            available: balanceAfter.toFixed(8),
            total: trx.raw('total + ?', [payout.toFixed(8)]),
            updated_at: new Date(),
          });

          await trx('balance_transactions').insert({
            user_id: pos.user_id,
            type: 'trade_credit',
            amount: payout.toFixed(8),
            balance_before: balanceBefore.toFixed(8),
            balance_after: balanceAfter.toFixed(8),
            reference_type: 'market_resolution',
            reference_id: marketId,
            description: `Market resolved ${outcome.toUpperCase()} - payout for ${pos.quantity} shares`,
          });

          totalPayouts = totalPayouts.plus(payout);
          winnersCount++;
        }
      }

      logger.info('Market resolved', {
        marketId,
        outcome,
        resolvedBy,
        totalPayouts: totalPayouts.toFixed(2),
        winnersCount,
      });

      return {
        totalPayouts: totalPayouts.toNumber(),
        winnersCount,
      };
    });
  }
}
