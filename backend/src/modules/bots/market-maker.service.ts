import Decimal from 'decimal.js';
import { db } from '../../database/connection';
import { config } from '../../config';
import { logger } from '../../common/logger';
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

  private async grantInventory(marketId: string, botIds: string[], yesPrice: number, noPrice: number): Promise<void> {
    const inventory = new Decimal(500);
    for (const userId of botIds) {
      for (const side of ['yes', 'no'] as const) {
        const avg = side === 'yes' ? yesPrice : noPrice;
        await db('positions')
          .insert({
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
          })
          .onConflict(['user_id', 'market_id', 'side'])
          .ignore();
      }
    }
  }
}
