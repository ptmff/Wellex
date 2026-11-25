/**
 * PortfolioService (src/modules/portfolio/portfolio.service.ts): unrealized/realized PnL,
 * PnL summary, balance history and Redis caching.
 */
import { db } from '../../src/database/connection';
import { redisClient } from '../../src/infrastructure/redis/cache.service';
import { PortfolioService } from '../../src/modules/portfolio/portfolio.service';
import { createExchange, createMarket, createUser, giveShares, settle } from '../helpers/db';
import { makeOrderBook } from '../helpers/services';

const FEE = 0.005;

describe('PortfolioService — PnL', () => {
  const portfolio = new PortfolioService();
  afterEach(async () => {
    await settle(50);
  });

  it('unrealized PnL = (current price - average price) * quantity, also in percent', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id, { yesPrice: 0.6 });
    await giveShares(u.id, marketId, 'yes', 10, 0.4);
    await giveShares(u.id, marketId, 'no', 5, 0.5); // NO price = 0.4 -> -0.5

    const positions = await portfolio.getPositions(u.id);
    const yes = positions.find((p) => p.side === 'yes')!;
    const no = positions.find((p) => p.side === 'no')!;
    expect(yes.unrealizedPnl).toBeCloseTo(2, 8);
    expect(yes.unrealizedPnlPct).toBeCloseTo(50, 8);
    expect(no.unrealizedPnl).toBeCloseTo(-0.5, 8);

    const p: any = await portfolio.getPortfolio(u.id);
    expect(p.pnl.unrealized).toBeCloseTo(1.5, 8);
    expect(p.positions).toMatchObject({ count: 2, open: 2 });
    expect(p.balance).toMatchObject({ available: 1000, reserved: 0, total: 1000 });
  });

  it('portfolio is cached in Redis (pm:portfolio:portfolio:<userId>, TTL <= 10s)', async () => {
    const u = await createUser();
    await portfolio.getPortfolio(u.id);
    const key = `pm:portfolio:portfolio:${u.id}`;
    expect(await redisClient.exists(key)).toBe(1);
    const ttl = await redisClient.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10);
  });

  // BUG-05: known defect, see docs/test-report/README.md. it.failing passes while the bug exists;
  // once the bug is fixed this test starts failing -> switch it back to it(...).
  it.failing('[BUG-05] right after buying at the market price the total PnL equals only the paid fee (cost is not counted as a loss)', async () => {
    const ob = makeOrderBook();
    await createExchange(0);
    const seller = await createUser();
    const buyer = await createUser();
    const marketId = await createMarket(seller.id);
    await giveShares(seller.id, marketId, 'yes', 10, 0.5);
    await ob.service.placeOrder(seller.id, marketId, { side: 'yes', action: 'sell', price: 0.55, quantity: 10 });
    await ob.service.placeOrder(buyer.id, marketId, { side: 'yes', action: 'buy', price: 0.55, quantity: 10 });

    const p: any = await portfolio.getPortfolio(buyer.id);
    // bought 10 YES for 5.5 + 0.0275 fee, market price is still 0.55 -> true PnL is -0.0275
    expect(p.pnl.total).toBeCloseTo(-5.5 * FEE, 4);
  });

  it('PnL summary: trading stats and resolution payouts after a resolved market', async () => {
    const ob = makeOrderBook();
    await createExchange(0);
    const yesHolder = await createUser();
    const noHolder = await createUser();
    const marketId = await createMarket(yesHolder.id);
    await ob.service.placeOrder(yesHolder.id, marketId, { side: 'yes', action: 'buy', price: 0.6, quantity: 10 });
    await ob.service.placeOrder(noHolder.id, marketId, { side: 'no', action: 'buy', price: 0.4, quantity: 10 });
    await ob.service.resolveMarket(marketId, 'yes', yesHolder.id);

    const s: any = await portfolio.getPnlSummary(yesHolder.id);
    expect(s.trading.tradeCount).toBe(1);
    expect(s.trading.totalTraded).toBeCloseTo(6, 8);
    expect(s.trading.totalFees).toBeCloseTo(6 * FEE, 8);
    expect(s.pnl.resolutionPayouts).toBeCloseTo(10, 8);
  });

  it('balance history is paginated and filterable by type', async () => {
    const u = await createUser();
    for (let i = 0; i < 3; i++) {
      await db('balance_transactions').insert({ user_id: u.id, type: 'ad_reward', amount: '100', balance_before: '0', balance_after: '100' });
    }
    await db('balance_transactions').insert({ user_id: u.id, type: 'purchase', amount: '500', balance_before: '0', balance_after: '500' });

    const page = await portfolio.getBalanceHistory(u.id, { page: 1, limit: 2 } as any);
    expect(page.total).toBe(4);
    expect(page.totalPages).toBe(2);
    expect(page.data).toHaveLength(2);
    const ads = await portfolio.getBalanceHistory(u.id, { page: 1, limit: 20, type: 'ad_reward' } as any);
    expect(ads.total).toBe(3);
  });
});
