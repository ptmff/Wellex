/**
 * Read-side API endpoints (markets, users, portfolio, analytics, activity, notifications) on a
 * market with real trades. Every endpoint must answer 2xx with { success: true }.
 */
import { API, bearer, createTestApp } from '../helpers/app';
import { createExchange, createMarket, createUser, giveShares, settle, TestUser } from '../helpers/db';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service';

describe('API — read endpoints on a traded market', () => {
  let t: ReturnType<typeof createTestApp>;
  let seller: TestUser;
  let buyer: TestUser;
  let marketId: string;

  beforeAll(() => {
    t = createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await createExchange(0);
    seller = await createUser({ username: 'seller_one' });
    buyer = await createUser({ username: 'buyer_one' });
    marketId = await createMarket(seller.id);
    await giveShares(seller.id, marketId, 'yes', 10);
    await t.api().post(`${API}/orders/${marketId}`).set(bearer(seller.token)).send({ side: 'yes', action: 'sell', price: 0.55, quantity: 10 }).expect(201);
    await t.api().post(`${API}/orders/${marketId}`).set(bearer(buyer.token)).send({ side: 'yes', action: 'buy', price: 0.55, quantity: 10 }).expect(201);
    await settle(150); // activity + notifications are written asynchronously
  });

  it('markets: list (filters, sorting), categories, details, stats', async () => {
    const list = await t.api().get(`${API}/markets?status=active&sortBy=volume_total&sortOrder=desc&limit=5`);
    expect(list.status).toBe(200);
    expect(list.body.data.data.length).toBeGreaterThanOrEqual(1);
    expect((await t.api().get(`${API}/markets?search=integration`)).status).toBe(200);
    expect((await t.api().get(`${API}/markets/categories`)).status).toBe(200);
    const one = await t.api().get(`${API}/markets/${marketId}`);
    expect(one.status).toBe(200);
    expect(one.body.data.id).toBe(marketId);
    const stats = await t.api().get(`${API}/markets/${marketId}/stats`);
    expect(stats.status).toBe(200);
  });

  it('market comments: add (auth), list, delete by author; foreign delete -> 403', async () => {
    const add = await t.api().post(`${API}/markets/${marketId}/comments`).set(bearer(buyer.token)).send({ body: 'Looks like YES to me' });
    expect(add.status).toBe(201);
    const list = await t.api().get(`${API}/markets/${marketId}/comments`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body.data)).toContain('Looks like YES to me');
    const commentId = add.body.data.id;
    expect((await t.api().delete(`${API}/markets/${marketId}/comments/${commentId}`).set(bearer(seller.token))).status).toBe(403);
    expect((await t.api().delete(`${API}/markets/${marketId}/comments/${commentId}`).set(bearer(buyer.token))).status).toBe(200);
  });

  it('users: profile, me, update profile, search, leaderboard', async () => {
    expect((await t.api().get(`${API}/users/buyer_one`)).status).toBe(200);
    expect((await t.api().get(`${API}/users/no_such_user`)).status).toBe(404);
    const me = await t.api().get(`${API}/users/me`).set(bearer(buyer.token));
    expect(me.status).toBe(200);
    const upd = await t.api().patch(`${API}/users/me`).set(bearer(buyer.token)).send({ displayName: 'Buyer One', bio: 'tester' });
    expect(upd.status).toBe(200);
    expect((await t.api().get(`${API}/users/search?q=buyer`)).status).toBe(200);
    expect((await t.api().get(`${API}/users/leaderboard`)).status).toBe(200);
  });

  it('portfolio: summary, positions, trades, balance history, pnl', async () => {
    for (const path of ['', '/positions', '/trades', '/balance-history', '/pnl']) {
      const r = await t.api().get(`${API}/portfolio${path}`).set(bearer(buyer.token));
      expect({ path, status: r.status }).toEqual({ path, status: 200 });
    }
    const positions = await t.api().get(`${API}/portfolio/positions`).set(bearer(buyer.token));
    expect(positions.body.data[0]).toMatchObject({ marketId, side: 'yes', quantity: 10 });
    expect((await t.api().get(`${API}/portfolio`)).status).toBe(401);
  });

  it('analytics: candles, price line, volume, platform metrics; candle aggregation job', async () => {
    await new AnalyticsService().aggregateCandles('1h' as any);
    for (const path of [`/markets/${marketId}/candles`, `/markets/${marketId}/price-line`, `/markets/${marketId}/volume`, '/platform']) {
      const r = await t.api().get(`${API}/analytics${path}`);
      expect({ path, status: r.status }).toEqual({ path, status: 200 });
    }
  });

  it('activity feeds and notifications (order_filled for both sides)', async () => {
    expect((await t.api().get(`${API}/activity`)).status).toBe(200);
    expect((await t.api().get(`${API}/activity/markets/${marketId}`)).status).toBe(200);
    expect((await t.api().get(`${API}/activity/me`).set(bearer(buyer.token))).status).toBe(200);

    const n = await t.api().get(`${API}/notifications`).set(bearer(buyer.token));
    expect(n.status).toBe(200);
    expect(JSON.stringify(n.body.data)).toContain('order_filled');
    expect((await t.api().post(`${API}/notifications/read-all`).set(bearer(buyer.token))).status).toBe(200);
  });
});
