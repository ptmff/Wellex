import Decimal from 'decimal.js';
import { db } from '../../database/connection';
import { logger } from '../../common/logger';
import { debitWx } from '../economy/wallet';
import { OrderBookService } from '../orders/orderbook.service';

const BOT_USERNAMES = ['bot_mm_1', 'bot_mm_2', 'bot_mm_3'] as const;

function clampPrice(price: number): number {
  return Math.min(0.99, Math.max(0.01, Number(price.toFixed(4))));
}

export class MarketMakerService {
  constructor(private readonly orderBookService: OrderBookService) {}

  async seedMarket(marketId: string, impliedYes: number): Promise<number> {
    const bots = await db('users').whereIn('username', [...BOT_USERNAMES]).select('id', 'username');
    if (bots.length === 0) {
      logger.warn('Market maker bots are missing; skip liquidity seed');
      return 0;
    }

    const yes = clampPrice(impliedYes);
    const no = clampPrice(1 - yes);
    const ladders = [
      { bidOffset: 0.03, askOffset: 0.03, qty: 80 },
      { bidOffset: 0.05, askOffset: 0.05, qty: 120 },
      { bidOffset: 0.08, askOffset: 0.08, qty: 160 },
    ];

    await this.grantInventory(marketId, bots.map((b) => b.id), yes, no);

    let placed = 0;
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      const ladder = ladders[i] ?? ladders[0];
      const orders = [
        { side: 'yes' as const, action: 'sell' as const, price: clampPrice(yes + ladder.askOffset), quantity: ladder.qty },
        { side: 'no' as const, action: 'sell' as const, price: clampPrice(no + ladder.askOffset), quantity: ladder.qty },
        { side: 'yes' as const, action: 'buy' as const, price: clampPrice(yes - ladder.bidOffset), quantity: ladder.qty },
        { side: 'no' as const, action: 'buy' as const, price: clampPrice(no - ladder.bidOffset), quantity: ladder.qty },
      ];

      for (const order of orders) {
        try {
          await this.orderBookService.placeOrder(bot.id, marketId, order);
          placed += 1;
        } catch (err) {
          logger.warn('MM order skipped', {
            marketId,
            bot: bot.username,
            error: (err as Error).message,
          });
        }
      }
    }

    return placed;
  }

  async requoteMarket(marketId: string, impliedYes: number): Promise<number> {
    const bots = await db('users').whereIn('username', [...BOT_USERNAMES]).select('id');
    const botIds = bots.map((b) => b.id);
    if (botIds.length === 0) return 0;

    const open = await db('orders')
      .where({ market_id: marketId })
      .whereIn('user_id', botIds)
      .whereIn('status', ['open', 'partially_filled', 'pending'])
      .select('id', 'user_id');

    for (const order of open) {
      try {
        await this.orderBookService.cancelOrder(order.user_id, order.id, 'MM requote');
      } catch (err) {
        logger.warn('MM requote cancel skipped', { orderId: order.id, error: (err as Error).message });
      }
    }

    return this.seedMarket(marketId, impliedYes);
  }

  /**
   * Mint YES+NO complete sets for MM bots with full collateral:
   * each set (1 YES + 1 NO) is paid for with 1 WX from the bot's balance,
   * and that WX goes into the market collateral pool (liquidity_total),
   * so resolution payouts are always covered.
   */
  private async grantInventory(marketId: string, botIds: string[], yesPrice: number, noPrice: number): Promise<void> {
    const inventory = new Decimal(500);

    await db.transaction(async (trx) => {
      let mintedSets = new Decimal(0);

      for (const userId of botIds) {
        const existing = await trx('positions')
          .where({ user_id: userId, market_id: marketId })
          .first();
        if (existing) continue;

        try {
          await debitWx(
            trx,
            userId,
            inventory,
            'adjustment',
            `MM inventory mint: ${inventory.toFixed(0)} YES/NO sets`,
            { referenceType: 'mm_inventory', referenceId: marketId }
          );
        } catch (err) {
          logger.warn('MM inventory skipped: bot cannot fund collateral', {
            marketId,
            botId: userId,
            error: (err as Error).message,
          });
          continue;
        }

        for (const side of ['yes', 'no'] as const) {
          const avg = side === 'yes' ? yesPrice : noPrice;
          await trx('positions').insert({
            user_id: userId,
            market_id: marketId,
            side,
            quantity: inventory.toFixed(8),
            reserved_quantity: '0',
            average_price: avg.toFixed(8),
            total_invested: inventory.mul(avg).toFixed(8),
            realized_pnl: '0',
            unrealized_pnl: '0',
            trade_count: 0,
          });
        }

        mintedSets = mintedSets.plus(inventory);
      }

      if (mintedSets.gt(0)) {
        await trx('markets')
          .where('id', marketId)
          .update({
            yes_shares: trx.raw('yes_shares + ?', [mintedSets.toFixed(8)]),
            no_shares: trx.raw('no_shares + ?', [mintedSets.toFixed(8)]),
            liquidity_total: trx.raw('liquidity_total + ?', [mintedSets.toFixed(8)]),
            updated_at: new Date(),
          });
      }
    });
  }
}
