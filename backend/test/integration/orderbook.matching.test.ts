/**
 * OrderBookService (src/modules/orders/orderbook.service.ts) on a real PostgreSQL + Redis.
 * Covers: reservation, limit matching (price-time priority, partial fills, maker price),
 * 0.5% fee, self-trade prevention, complementary BUY YES + BUY NO minting, cancel, expiry.
 */
import { db } from '../../src/database/connection';
import { ErrorCode } from '../../src/common/errors';
import { redisClient } from '../../src/infrastructure/redis/cache.service';
import { balanceOf, createExchange, createMarket, createUser, giveShares, positionOf, settle } from '../helpers/db';
import { makeOrderBook } from '../helpers/services';

const FEE = 0.005;

describe('OrderBookService — limit orders, reservation, matching', () => {
  let ob: ReturnType<typeof makeOrderBook>;
  beforeEach(() => {
    ob = makeOrderBook();
  });
  afterEach(async () => {
    await settle(50);
  });

  it('BUY limit reserves qty*price*(1+0.5%) of cash and creates an open order', async () => {
    const buyer = await createUser({ balance: 1000 });
    const marketId = await createMarket(buyer.id);

    const order = await ob.service.placeOrder(buyer.id, marketId, { side: 'yes', action: 'buy', price: 0.6, quantity: 10 });

    expect(order.status).toBe('open');
    expect(order.totalCost).toBeCloseTo(6.03, 8); // 6 + 0.5% fee
    expect(order.fee).toBeCloseTo(0.03, 8);
    const bal = await balanceOf(buyer.id);
    expect(bal.available).toBeCloseTo(993.97, 8);
    expect(bal.reserved).toBeCloseTo(6.03, 8);
    expect(await db('trades').count('* as c').first()).toEqual({ c: '0' });
  });

  it('BUY limit with insufficient cash is rejected and nothing is written', async () => {
    const buyer = await createUser({ balance: 5 });
    const marketId = await createMarket(buyer.id);

    await expect(
      ob.service.placeOrder(buyer.id, marketId, { side: 'yes', action: 'buy', price: 0.6, quantity: 10 })
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_BALANCE, statusCode: 400 });

    const bal = await balanceOf(buyer.id);
    expect(bal.available).toBe(5);
    expect(bal.reserved).toBe(0);
    expect(await db('orders').count('* as c').first()).toEqual({ c: '0' });
  });

  it('SELL limit without shares is rejected (INSUFFICIENT_SHARES); with shares it reserves them', async () => {
    const seller = await createUser();
    const marketId = await createMarket(seller.id);

    await expect(
      ob.service.placeOrder(seller.id, marketId, { side: 'yes', action: 'sell', price: 0.55, quantity: 10 })
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_SHARES });

    await giveShares(seller.id, marketId, 'yes', 20);
    await ob.service.placeOrder(seller.id, marketId, { side: 'yes', action: 'sell', price: 0.55, quantity: 10 });
    expect(await positionOf(seller.id, marketId, 'yes')).toMatchObject({ quantity: 20, reserved: 10 });

    // only 10 of 20 shares are still free
    await expect(
      ob.service.placeOrder(seller.id, marketId, { side: 'yes', action: 'sell', price: 0.6, quantity: 11 })
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_SHARES });
  });

  it('rejects orders on inactive / closed markets and invalid prices', async () => {
    const u = await createUser();
    const paused = await createMarket(u.id, { status: 'paused' });
    const closed = await createMarket(u.id, { closesInMs: -60_000 });
    const active = await createMarket(u.id);

    await expect(ob.service.placeOrder(u.id, paused, { side: 'yes', action: 'buy', price: 0.5, quantity: 1 }))
      .rejects.toMatchObject({ code: ErrorCode.MARKET_INACTIVE });
    await expect(ob.service.placeOrder(u.id, closed, { side: 'yes', action: 'buy', price: 0.5, quantity: 1 }))
      .rejects.toMatchObject({ code: ErrorCode.MARKET_CLOSED });
    await expect(ob.service.placeOrder(u.id, active, { side: 'yes', action: 'buy', price: 1, quantity: 1 }))
      .rejects.toThrow();
    await expect(ob.service.placeOrder(u.id, active, { side: 'yes', action: 'buy', price: 0.5, quantity: 0 }))
      .rejects.toThrow();
  });

  it('crossing BUY taker fills at the maker (SELL) price; buyer gets the price-improvement refund; fees 0.5% each side go to the exchange', async () => {
    const exchange = await createExchange(0);
    const seller = await createUser();
    const buyer = await createUser();
    const marketId = await createMarket(seller.id);
    await giveShares(seller.id, marketId, 'yes', 10, 0.4);

    const sell = await ob.service.placeOrder(seller.id, marketId, { side: 'yes', action: 'sell', price: 0.55, quantity: 10 });
    const buy = await ob.service.placeOrder(buyer.id, marketId, { side: 'yes', action: 'buy', price: 0.6, quantity: 10 });

    const trades = await db('trades').where({ market_id: marketId });
    expect(trades).toHaveLength(1);
    expect(Number(trades[0].price)).toBeCloseTo(0.55, 8);
    expect(Number(trades[0].quantity)).toBeCloseTo(10, 8);
    expect(Number(trades[0].fee)).toBeCloseTo(2 * 5.5 * FEE, 8); // 0.055

    const buyerBal = await balanceOf(buyer.id);
    expect(buyerBal.available).toBeCloseTo(1000 - 5.5 * (1 + FEE), 8); // 994.4725 (0.5025 refunded)
    expect(buyerBal.reserved).toBeCloseTo(0, 8);
    const sellerBal = await balanceOf(seller.id);
    expect(sellerBal.available).toBeCloseTo(1000 + 5.5 * (1 - FEE), 8); // 1005.4725
    const exBal = await balanceOf(exchange.id);
    expect(exBal.available).toBeCloseTo(0.055, 8);

    // cash is conserved between participants and the fee sink
    expect(buyerBal.available + sellerBal.available + exBal.available).toBeCloseTo(2000, 8);

    expect(await positionOf(buyer.id, marketId, 'yes')).toMatchObject({ quantity: 10, reserved: 0, averagePrice: 0.55 });
    expect(await positionOf(seller.id, marketId, 'yes')).toMatchObject({ quantity: 0, reserved: 0 });
    const orders = await db('orders').whereIn('id', [sell.id, buy.id]);
    expect(orders.map((o) => o.status).sort()).toEqual(['filled', 'filled']);
    const market = await db('markets').where('id', marketId).first();
    expect(Number(market.current_yes_price)).toBeCloseTo(0.55, 8);
    expect(Number(market.current_no_price)).toBeCloseTo(0.45, 8);
  });

  it('matching follows price-time priority and supports partial fills', async () => {
    const s1 = await createUser();
    const s2 = await createUser();
    const s3 = await createUser();
    const buyer = await createUser();
    const marketId = await createMarket(buyer.id);
    for (const s of [s1, s2, s3]) await giveShares(s.id, marketId, 'yes', 5);

    const o1 = await ob.service.placeOrder(s1.id, marketId, { side: 'yes', action: 'sell', price: 0.5, quantity: 5 });
    const o2 = await ob.service.placeOrder(s2.id, marketId, { side: 'yes', action: 'sell', price: 0.5, quantity: 5 });
    const o3 = await ob.service.placeOrder(s3.id, marketId, { side: 'yes', action: 'sell', price: 0.45, quantity: 5 });

    const taker = await ob.service.placeOrder(buyer.id, marketId, { side: 'yes', action: 'buy', price: 0.55, quantity: 8 });
    void taker;

    const byId = Object.fromEntries((await db('orders')).map((o) => [o.id, o]));
    expect(byId[o3.id].status).toBe('filled'); // best price first
    expect(byId[o1.id].status).toBe('partially_filled'); // same price, earlier order first
    expect(Number(byId[o1.id].remaining_quantity)).toBeCloseTo(2, 8);
    expect(byId[o2.id].status).toBe('open');

    const trades = await db('trades').where({ market_id: marketId }).orderBy('executed_at', 'asc');
    expect(trades.map((t) => [Number(t.price), Number(t.quantity)])).toEqual([[0.45, 5], [0.5, 3]]);
    expect(await positionOf(buyer.id, marketId, 'yes')).toMatchObject({ quantity: 8 });
  });

  it('non-crossing orders rest in the book; snapshot aggregates price levels, spread and mid price', async () => {
    const seller = await createUser();
    const b1 = await createUser();
    const b2 = await createUser();
    const marketId = await createMarket(seller.id);
    await giveShares(seller.id, marketId, 'yes', 10);

    await ob.service.placeOrder(seller.id, marketId, { side: 'yes', action: 'sell', price: 0.7, quantity: 10 });
    await ob.service.placeOrder(b1.id, marketId, { side: 'yes', action: 'buy', price: 0.6, quantity: 4 });
    await ob.service.placeOrder(b2.id, marketId, { side: 'yes', action: 'buy', price: 0.6, quantity: 6 });

    expect(await db('trades').count('* as c').first()).toEqual({ c: '0' });
    // Isolate the aggregation logic from the stale-cache defect covered by the dedicated
    // "cache is invalidated on placeOrder" test (BUG-01 in docs/test-report): drop cached snapshots.
    await settle(50);
    const cached = await redisClient.keys('pm:orderbook:*');
    if (cached.length) await redisClient.del(...cached);
    const book = await ob.service.getOrderBook(marketId);
    expect(book.yesBids).toEqual([{ price: 0.6, quantity: 10, orderCount: 2 }]);
    expect(book.yesAsks).toEqual([{ price: 0.7, quantity: 10, orderCount: 1 }]);
    expect(book.spread.yes).toBeCloseTo(0.1, 8);
    expect(book.midPrice.yes).toBeCloseTo(0.65, 8);
  });

  it('a user never matches against his own resting order (self-trade prevention in limit matching)', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id);
    await giveShares(u.id, marketId, 'yes', 5);

    await ob.service.placeOrder(u.id, marketId, { side: 'yes', action: 'sell', price: 0.5, quantity: 5 });
    await ob.service.placeOrder(u.id, marketId, { side: 'yes', action: 'buy', price: 0.6, quantity: 5 });

    expect(await db('trades').count('* as c').first()).toEqual({ c: '0' });
    const statuses = (await db('orders')).map((o) => o.status);
    expect(statuses).toEqual(['open', 'open']);
  });

  it('BUY YES + BUY NO with prices summing to >= 1 mint a pair of shares backed by 1.0 collateral', async () => {
    const yesBuyer = await createUser();
    const noBuyer = await createUser();
    const marketId = await createMarket(yesBuyer.id);

    await ob.service.placeOrder(yesBuyer.id, marketId, { side: 'yes', action: 'buy', price: 0.6, quantity: 10 });
    await ob.service.placeOrder(noBuyer.id, marketId, { side: 'no', action: 'buy', price: 0.45, quantity: 10 });

    expect(await positionOf(yesBuyer.id, marketId, 'yes')).toMatchObject({ quantity: 10 });
    expect(await positionOf(noBuyer.id, marketId, 'no')).toMatchObject({ quantity: 10 });
    expect((await balanceOf(yesBuyer.id)).available).toBeCloseTo(1000 - 6 * (1 + FEE), 8);
    expect((await balanceOf(noBuyer.id)).available).toBeCloseTo(1000 - 4.5 * (1 + FEE), 8);
    const market = await db('markets').where('id', marketId).first();
    expect(Number(market.liquidity_total)).toBeCloseTo(10, 8); // 1.0 collateral per pair
    expect(Number(market.yes_shares)).toBeCloseTo(10, 8);
    expect(Number(market.no_shares)).toBeCloseTo(10, 8);
  });

  // BUG-02: known defect, see docs/test-report/README.md. it.failing passes while the bug exists;
  // once the bug is fixed this test starts failing -> switch it back to it(...).
  it.failing('[BUG-02] after a complementary fill the market YES price reflects what the YES buyer paid (between 0.55 and 0.60)', async () => {
    // YES buyer rests at 0.60, NO buyer arrives as taker at 0.45 -> YES is worth 0.55..0.60.
    const yesBuyer = await createUser();
    const noBuyer = await createUser();
    const marketId = await createMarket(yesBuyer.id);

    await ob.service.placeOrder(yesBuyer.id, marketId, { side: 'yes', action: 'buy', price: 0.6, quantity: 10 });
    await ob.service.placeOrder(noBuyer.id, marketId, { side: 'no', action: 'buy', price: 0.45, quantity: 10 });

    const market = await db('markets').where('id', marketId).first();
    const yes = Number(market.current_yes_price);
    expect(yes).toBeGreaterThanOrEqual(0.55);
    expect(yes).toBeLessThanOrEqual(0.6);
  });

  it('complementary BUY orders whose prices sum to < 1 do not match', async () => {
    const a = await createUser();
    const b = await createUser();
    const marketId = await createMarket(a.id);
    await ob.service.placeOrder(a.id, marketId, { side: 'yes', action: 'buy', price: 0.5, quantity: 10 });
    await ob.service.placeOrder(b.id, marketId, { side: 'no', action: 'buy', price: 0.4, quantity: 10 });
    expect(await db('trades').count('* as c').first()).toEqual({ c: '0' });
  });
});

describe('OrderBookService — cancel and expiry', () => {
  let ob: ReturnType<typeof makeOrderBook>;
  beforeEach(() => {
    ob = makeOrderBook();
  });
  afterEach(async () => {
    await settle(50);
  });

  it('cancelling a BUY order releases exactly the reserved cash; second cancel fails', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id);
    const order = await ob.service.placeOrder(u.id, marketId, { side: 'yes', action: 'buy', price: 0.6, quantity: 10 });

    await ob.service.cancelOrder(u.id, order.id);

    expect(await balanceOf(u.id)).toMatchObject({ available: 1000, reserved: 0 });
    const row = await db('orders').where('id', order.id).first();
    expect(row.status).toBe('cancelled');
    const refund = await db('balance_transactions').where({ user_id: u.id, type: 'refund' }).first();
    expect(Number(refund.amount)).toBeCloseTo(6.03, 8);

    await expect(ob.service.cancelOrder(u.id, order.id)).rejects.toMatchObject({ code: ErrorCode.ORDER_ALREADY_CANCELLED });
  });

  it('only the owner can cancel an order (403 FORBIDDEN), unknown order -> 404', async () => {
    const owner = await createUser();
    const other = await createUser();
    const marketId = await createMarket(owner.id);
    const order = await ob.service.placeOrder(owner.id, marketId, { side: 'yes', action: 'buy', price: 0.5, quantity: 2 });

    await expect(ob.service.cancelOrder(other.id, order.id)).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });
    await expect(ob.service.cancelOrder(owner.id, '00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('cancelling a partially filled BUY refunds only the unfilled remainder; filled order cannot be cancelled', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const marketId = await createMarket(seller.id);
    await giveShares(seller.id, marketId, 'yes', 4);
    const sell = await ob.service.placeOrder(seller.id, marketId, { side: 'yes', action: 'sell', price: 0.5, quantity: 4 });
    const buy = await ob.service.placeOrder(buyer.id, marketId, { side: 'yes', action: 'buy', price: 0.5, quantity: 10 });

    await ob.service.cancelOrder(buyer.id, buy.id);
    const bal = await balanceOf(buyer.id);
    expect(bal.reserved).toBeCloseTo(0, 8);
    expect(bal.available).toBeCloseTo(1000 - 4 * 0.5 * (1 + FEE), 8);

    await expect(ob.service.cancelOrder(seller.id, sell.id)).rejects.toMatchObject({ code: ErrorCode.ORDER_ALREADY_FILLED });
  });

  it('cancelling a SELL order releases the reserved shares', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id);
    await giveShares(u.id, marketId, 'no', 7);
    const order = await ob.service.placeOrder(u.id, marketId, { side: 'no', action: 'sell', price: 0.3, quantity: 7 });
    expect(await positionOf(u.id, marketId, 'no')).toMatchObject({ reserved: 7 });
    await ob.service.cancelOrder(u.id, order.id);
    expect(await positionOf(u.id, marketId, 'no')).toMatchObject({ quantity: 7, reserved: 0 });
  });

  it('expireStaleOrders() expires orders past expires_at and refunds them', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id);
    const order = await ob.service.placeOrder(u.id, marketId, {
      side: 'yes', action: 'buy', price: 0.4, quantity: 5, expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await db('orders').where('id', order.id).update({ expires_at: new Date(Date.now() - 1000) });

    expect(await ob.service.expireStaleOrders()).toBe(1);
    expect((await db('orders').where('id', order.id).first()).status).toBe('expired');
    expect(await balanceOf(u.id)).toMatchObject({ available: 1000, reserved: 0 });
  });

  it('expireDueMarkets() moves overdue active markets to "expired" and releases their resting orders', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id);
    await ob.service.placeOrder(u.id, marketId, { side: 'yes', action: 'buy', price: 0.4, quantity: 5 });
    await db('markets').where('id', marketId).update({ closes_at: new Date(Date.now() - 1000) });

    expect(await ob.service.expireDueMarkets()).toBe(1);
    expect((await db('markets').where('id', marketId).first()).status).toBe('expired');
    expect(await balanceOf(u.id)).toMatchObject({ available: 1000, reserved: 0 });
  });

  // BUG-01: known defect, see docs/test-report/README.md. it.failing passes while the bug exists;
  // once the bug is fixed this test starts failing -> switch it back to it(...).
  it.failing('[BUG-01] order book snapshot reflects a newly placed order immediately (cache is invalidated on placeOrder)', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id);
    const before = await ob.service.getOrderBook(marketId); // warms the 2s Redis cache
    expect(before.yesBids).toEqual([]);

    await ob.service.placeOrder(u.id, marketId, { side: 'yes', action: 'buy', price: 0.42, quantity: 3 });
    const after = await ob.service.getOrderBook(marketId);
    expect(after.yesBids).toEqual([{ price: 0.42, quantity: 3, orderCount: 1 }]);
  });
});
