/**
 * End-to-end API scenarios on the real app: RBAC, limit order + matching, market trade,
 * cancel, market resolution with payouts, economy endpoints, Redis caching and invalidation.
 */
import { db } from '../../src/database/connection';
import { redisClient } from '../../src/infrastructure/redis/cache.service';
import { API, bearer, createTestApp } from '../helpers/app';
import { createExchange, createMarket, createUser, giveShares, settle } from '../helpers/db';

const FEE = 0.005;
const futureIso = (h = 48) => new Date(Date.now() + h * 3600_000).toISOString();
const newMarketBody = () => ({
  title: 'Will the API test-suite create a market?',
  description: 'Market created through POST /api/v1/markets by the API tests.',
  resolutionCriteria: 'Resolves YES when the market is visible in the API.',
  closesAt: futureIso(),
});

describe('API — RBAC', () => {
  let t: ReturnType<typeof createTestApp>;
  beforeAll(() => {
    t = createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  afterEach(async () => {
    await settle(50);
  });

  it('POST /markets: user -> 403, moderator -> 201, anonymous -> 401', async () => {
    const user = await createUser();
    const mod = await createUser({ role: 'moderator' });
    expect((await t.api().post(`${API}/markets`).send(newMarketBody())).status).toBe(401);
    const forbidden = await t.api().post(`${API}/markets`).set(bearer(user.token)).send(newMarketBody());
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    const created = await t.api().post(`${API}/markets`).set(bearer(mod.token)).send(newMarketBody());
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('active');
  });

  it('PATCH /markets/:id by a regular user -> 403; by a moderator -> 200', async () => {
    const user = await createUser();
    const mod = await createUser({ role: 'moderator' });
    const marketId = await createMarket(mod.id);
    const patch = { title: 'Updated title for the API test market' };
    expect((await t.api().patch(`${API}/markets/${marketId}`).set(bearer(user.token)).send(patch)).status).toBe(403);
    const ok = await t.api().patch(`${API}/markets/${marketId}`).set(bearer(mod.token)).send(patch);
    expect(ok.status).toBe(200);
  });

  it('/admin/*: user -> 403; moderator may resolve markets but not manage users (admin only)', async () => {
    const user = await createUser();
    const mod = await createUser({ role: 'moderator' });
    const victim = await createUser();
    const marketId = await createMarket(mod.id);

    expect((await t.api().post(`${API}/admin/markets/${marketId}/resolve`).set(bearer(user.token)).send({ outcome: 'yes' })).status).toBe(403);
    expect((await t.api().patch(`${API}/admin/users/${victim.id}/status`).set(bearer(mod.token)).send({ status: 'banned' })).status).toBe(403);
    const resolved = await t.api().post(`${API}/admin/markets/${marketId}/resolve`).set(bearer(mod.token)).send({ outcome: 'no' });
    expect(resolved.status).toBe(200);
  });

  it('admin bans a user -> the banned user loses API access immediately (user cache invalidated)', async () => {
    const admin = await createUser({ role: 'admin' });
    const victim = await createUser();
    await t.api().get(`${API}/auth/me`).set(bearer(victim.token)).expect(200); // warms the user cache

    const r = await t.api().patch(`${API}/admin/users/${victim.id}/status`).set(bearer(admin.token)).send({ status: 'banned' });
    expect(r.status).toBe(200);
    const after = await t.api().get(`${API}/auth/me`).set(bearer(victim.token));
    expect(after.status).toBe(401);
    expect(after.body.error.message).toBe('Account is not active');
  });

  // BUG-07: known defect, see docs/test-report/README.md. it.failing passes while the bug exists;
  // once the bug is fixed this test starts failing -> switch it back to it(...).
  it.failing('[BUG-07] GET /admin/users (admin) returns the paginated user list', async () => {
    const admin = await createUser({ role: 'admin' });
    await createUser();
    const r = await t.api().get(`${API}/admin/users?page=1&limit=10`).set(bearer(admin.token));
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBe(2);
  });
});

describe('API — orders, trades, resolution, economy', () => {
  let t: ReturnType<typeof createTestApp>;
  beforeEach(() => {
    t = createTestApp(); // fresh trading limiter (30 req/min) per test
  });
  afterEach(async () => {
    await settle(80);
    await t.close();
  });

  it('limit order flow: place SELL + crossing BUY via API -> trade at maker price; GET /orders shows both filled', async () => {
    await createExchange(0);
    const seller = await createUser();
    const buyer = await createUser();
    const marketId = await createMarket(seller.id);
    await giveShares(seller.id, marketId, 'yes', 10);

    const sell = await t.api().post(`${API}/orders/${marketId}`).set(bearer(seller.token)).send({ side: 'yes', action: 'sell', price: 0.55, quantity: 10 });
    expect(sell.status).toBe(201);
    const buy = await t.api().post(`${API}/orders/${marketId}`).set(bearer(buyer.token)).send({ side: 'yes', action: 'buy', price: 0.6, quantity: 10 });
    expect(buy.status).toBe(201);

    const mine = await t.api().get(`${API}/orders?status=filled`).set(bearer(buyer.token));
    expect(mine.status).toBe(200);
    expect(mine.body.data.data).toHaveLength(1);
    expect(mine.body.data.data[0]).toMatchObject({ status: 'filled', averageFillPrice: 0.55 });

    const portfolio = await t.api().get(`${API}/portfolio`).set(bearer(buyer.token));
    expect(portfolio.status).toBe(200);
    expect(portfolio.body.data.balance.available).toBeCloseTo(1000 - 5.5 * (1 + FEE), 6);
  });

  it('order validation and ownership: price >= 1 -> 422, foreign order -> 403, cancel own order -> 200', async () => {
    const owner = await createUser();
    const other = await createUser();
    const marketId = await createMarket(owner.id);

    const invalid = await t.api().post(`${API}/orders/${marketId}`).set(bearer(owner.token)).send({ side: 'yes', action: 'buy', price: 1.5, quantity: 1 });
    expect(invalid.status).toBe(422);
    const placed = await t.api().post(`${API}/orders/${marketId}`).set(bearer(owner.token)).send({ side: 'yes', action: 'buy', price: 0.3, quantity: 10 });
    const orderId = placed.body.data.id;

    expect((await t.api().get(`${API}/orders/${orderId}`).set(bearer(other.token))).status).toBe(403);
    expect((await t.api().delete(`${API}/orders/${orderId}`).set(bearer(other.token))).status).toBe(403);
    const cancelled = await t.api().delete(`${API}/orders/${orderId}`).set(bearer(owner.token));
    expect(cancelled.status).toBe(200);
    const again = await t.api().delete(`${API}/orders/${orderId}`).set(bearer(owner.token));
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('ORDER_ALREADY_CANCELLED');
  });

  // BUG-08: known defect, see docs/test-report/README.md. it.failing passes while the bug exists;
  // once the bug is fixed this test starts failing -> switch it back to it(...).
  it.failing('[BUG-08] malformed ids are client errors: GET /orders/not-a-uuid and GET /markets/not-a-uuid -> 4xx, not 500', async () => {
    const u = await createUser();
    const o = await t.api().get(`${API}/orders/not-a-uuid`).set(bearer(u.token));
    const m = await t.api().get(`${API}/markets/not-a-uuid`);
    expect(o.status).toBeGreaterThanOrEqual(400);
    expect(o.status).toBeLessThan(500);
    expect(m.status).toBeGreaterThanOrEqual(400);
    expect(m.status).toBeLessThan(500);
  });

  it('market trade via API: quote, then trade with slippage guard (positive and negative)', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const marketId = await createMarket(seller.id);
    await giveShares(seller.id, marketId, 'yes', 20);
    await t.api().post(`${API}/orders/${marketId}`).set(bearer(seller.token)).send({ side: 'yes', action: 'sell', price: 0.5, quantity: 10 }).expect(201);
    await t.api().post(`${API}/orders/${marketId}`).set(bearer(seller.token)).send({ side: 'yes', action: 'sell', price: 0.7, quantity: 10 }).expect(201);

    const quote = await t.api().post(`${API}/trading/${marketId}/quote`).send({ side: 'yes', action: 'buy', amount: 9 });
    expect(quote.status).toBe(200);
    expect(quote.body.data.averagePrice).toBeGreaterThan(0.5);

    const slip = await t.api().post(`${API}/trading/${marketId}/trade`).set(bearer(buyer.token)).send({ side: 'yes', action: 'buy', amount: 9, expectedPrice: 0.5, maxSlippage: 1 });
    expect(slip.status).toBe(400);
    expect(slip.body.error.code).toBe('SLIPPAGE_EXCEEDED');

    const ok = await t.api().post(`${API}/trading/${marketId}/trade`).set(bearer(buyer.token)).send({ side: 'yes', action: 'buy', amount: 9, expectedPrice: quote.body.data.averagePrice, maxSlippage: 1 });
    expect(ok.status).toBe(201);
    expect(ok.body.data.sharesTransacted).toBeCloseTo(quote.body.data.shares, 6);
    expect(ok.body.data.newBalance).toBeCloseTo(991, 6);

    const noAuth = await t.api().post(`${API}/trading/${marketId}/trade`).send({ side: 'yes', action: 'buy', amount: 1 });
    expect(noAuth.status).toBe(401);
    const bad = await t.api().post(`${API}/trading/${marketId}/trade`).set(bearer(buyer.token)).send({ side: 'maybe', action: 'buy', amount: -1 });
    expect(bad.status).toBe(422);
  });

  it('admin resolves a market via API -> winners are paid, market cache is invalidated', async () => {
    await createExchange(0);
    const admin = await createUser({ role: 'admin' });
    const yesHolder = await createUser();
    const noHolder = await createUser();
    const marketId = await createMarket(admin.id);
    await t.api().post(`${API}/orders/${marketId}`).set(bearer(yesHolder.token)).send({ side: 'yes', action: 'buy', price: 0.7, quantity: 10 }).expect(201);
    await t.api().post(`${API}/orders/${marketId}`).set(bearer(noHolder.token)).send({ side: 'no', action: 'buy', price: 0.3, quantity: 10 }).expect(201);

    const before = await t.api().get(`${API}/markets/${marketId}`);
    expect(before.status).toBe(200);
    expect(await redisClient.exists(`pm:markets:market:${marketId}`)).toBe(1);
    const ttl = await redisClient.ttl(`pm:markets:market:${marketId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);

    const res = await t.api().post(`${API}/admin/markets/${marketId}/resolve`).set(bearer(admin.token)).send({ outcome: 'yes', note: 'api test' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ totalPayouts: 10, winnersCount: 1 });
    expect(await redisClient.exists(`pm:markets:market:${marketId}`)).toBe(0);

    const after = await t.api().get(`${API}/markets/${marketId}`);
    expect(after.body.data.status).toBe('resolved');
    const winner = await db('balances').where('user_id', yesHolder.id).first();
    expect(Number(winner.available_cash)).toBeCloseTo(1000 - 7 * (1 + FEE) + 10, 6);

    const twice = await t.api().post(`${API}/admin/markets/${marketId}/resolve`).set(bearer(admin.token)).send({ outcome: 'no' });
    expect(twice.status).toBe(400);
    expect(twice.body.error.code).toBe('MARKET_ALREADY_RESOLVED');
    const badOutcome = await t.api().post(`${API}/admin/markets/${marketId}/resolve`).set(bearer(admin.token)).send({ outcome: 'maybe' });
    expect(badOutcome.status).toBe(422);
  });

  it('economy via API: daily bonus 200 then 429; ad session 201; purchase 201; /economy/me', async () => {
    const u = await createUser();
    const first = await t.api().post(`${API}/economy/daily-bonus`).set(bearer(u.token));
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ wxAmount: 25, streak: 1 });
    const second = await t.api().post(`${API}/economy/daily-bonus`).set(bearer(u.token));
    expect(second.status).toBe(429);

    const session = await t.api().post(`${API}/economy/ads/session`).set(bearer(u.token));
    expect(session.status).toBe(201);
    const early = await t.api().post(`${API}/economy/ad-reward`).set(bearer(u.token)).send({ sessionId: session.body.data.sessionId });
    expect(early.status).toBe(400);

    const purchase = await t.api().post(`${API}/economy/purchase`).set(bearer(u.token)).send({ packageSlug: 'pack' });
    expect(purchase.status).toBe(201);
    const me = await t.api().get(`${API}/economy/me`).set(bearer(u.token));
    expect(me.body.data.available).toBe(1000 + 25 + 2000);
    expect((await t.api().get(`${API}/economy/packages`)).body.data).toHaveLength(3);
  });

  it('GET /health and /health/detailed report database and redis as ok; unknown route -> 404', async () => {
    expect((await t.api().get('/health')).body.status).toBe('ok');
    const d = await t.api().get('/health/detailed');
    expect(d.body).toMatchObject({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
    const nf = await t.api().get(`${API}/nope`);
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
  });
});
