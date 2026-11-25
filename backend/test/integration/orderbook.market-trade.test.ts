/**
 * Market (taker) trades with slippage protection, quotes, and market resolution with payouts.
 * Real code: OrderBookService.getTradeQuote / executeMarketTrade / resolveMarket.
 */
import { db } from '../../src/database/connection';
import { ErrorCode } from '../../src/common/errors';
import { balanceOf, createExchange, createMarket, createUser, giveShares, positionOf, settle } from '../helpers/db';
import { makeOrderBook } from '../helpers/services';

const FEE = 0.005;

async function bookWithTwoAsks(ob: ReturnType<typeof makeOrderBook>) {
  const s1 = await createUser();
  const s2 = await createUser();
  const marketId = await createMarket(s1.id);
  await giveShares(s1.id, marketId, 'yes', 10);
  await giveShares(s2.id, marketId, 'yes', 10);
  await ob.service.placeOrder(s1.id, marketId, { side: 'yes', action: 'sell', price: 0.5, quantity: 10 });
  await ob.service.placeOrder(s2.id, marketId, { side: 'yes', action: 'sell', price: 0.6, quantity: 10 });
  return { s1, s2, marketId };
}

describe('OrderBookService — market trades and slippage', () => {
  let ob: ReturnType<typeof makeOrderBook>;
  beforeEach(() => {
    ob = makeOrderBook();
  });
  afterEach(async () => {
    await settle(50);
  });

  it('quote sweeps the book: budget 8 WX buys 10 @0.50 + the rest @0.60, fee included', async () => {
    const { marketId } = await bookWithTwoAsks(ob);
    const q = await ob.service.getTradeQuote(marketId, 'yes', 'buy', 8);

    const level2Qty = (8 - 5 * (1 + FEE)) / (0.6 * (1 + FEE));
    expect(q.shares).toBeCloseTo(10 + level2Qty, 6);
    expect(q.totalCost).toBeCloseTo(8, 6);
    expect(q.averagePrice).toBeCloseTo((5 + level2Qty * 0.6) / (10 + level2Qty), 6);
    expect(q.fee).toBeCloseTo((5 + level2Qty * 0.6) * FEE, 6);
    expect(q.priceImpact).toBeGreaterThan(0);
  });

  it('market BUY whose average price deviates more than maxSlippage from expectedPrice is rejected and fully rolled back', async () => {
    const { marketId } = await bookWithTwoAsks(ob);
    const buyer = await createUser();

    await expect(
      ob.service.executeMarketTrade({ userId: buyer.id, marketId, side: 'yes', action: 'buy', amount: 8, expectedPrice: 0.5, maxSlippage: 5 })
    ).rejects.toMatchObject({ code: ErrorCode.SLIPPAGE_EXCEEDED });

    expect(await balanceOf(buyer.id)).toMatchObject({ available: 1000, reserved: 0 });
    expect(await db('trades').count('* as c').first()).toEqual({ c: '0' });
    const open = await db('orders').where({ market_id: marketId }).whereIn('status', ['open']);
    expect(open).toHaveLength(2);
  });

  it('market BUY within tolerance executes exactly as quoted (shares, cost, fee) and pays makers at their prices', async () => {
    const exchange = await createExchange(0);
    const { s1, s2, marketId } = await bookWithTwoAsks(ob);
    const buyer = await createUser();
    const quote = await ob.service.getTradeQuote(marketId, 'yes', 'buy', 8);

    const r = await ob.service.executeMarketTrade({ userId: buyer.id, marketId, side: 'yes', action: 'buy', amount: 8, expectedPrice: 0.5, maxSlippage: 10 });

    expect(r.sharesTransacted).toBeCloseTo(quote.shares, 8);
    expect(r.totalCost).toBeCloseTo(quote.totalCost, 8);
    expect(r.fee).toBeCloseTo(quote.fee, 8);
    expect(r.averagePrice).toBeCloseTo(quote.averagePrice, 8);
    expect(r.newBalance).toBeCloseTo(992, 6);
    expect((await positionOf(buyer.id, marketId, 'yes'))!.quantity).toBeCloseTo(quote.shares, 6);
    expect((await balanceOf(s1.id)).available).toBeCloseTo(1000 + 5 * (1 - FEE), 8);
    const lvl2 = quote.shares - 10;
    expect((await balanceOf(s2.id)).available).toBeCloseTo(1000 + lvl2 * 0.6 * (1 - FEE), 6);
    // exchange receives buyer fee + seller fee for every fill
    expect((await balanceOf(exchange.id)).available).toBeCloseTo(2 * quote.fee, 6);
    expect(await db('trades').count('* as c').first()).toEqual({ c: '2' });
  });

  it('market BUY: no liquidity -> INVALID_TRADE_AMOUNT; amount below minimum -> MIN_TRADE_AMOUNT; not enough cash -> INSUFFICIENT_BALANCE', async () => {
    const u = await createUser({ balance: 3 });
    const marketId = await createMarket(u.id);
    await expect(ob.service.executeMarketTrade({ userId: u.id, marketId, side: 'yes', action: 'buy', amount: 2 }))
      .rejects.toMatchObject({ code: ErrorCode.INVALID_TRADE_AMOUNT });
    await expect(ob.service.executeMarketTrade({ userId: u.id, marketId, side: 'yes', action: 'buy', amount: 0.5 }))
      .rejects.toMatchObject({ code: ErrorCode.MIN_TRADE_AMOUNT });
    await expect(ob.service.executeMarketTrade({ userId: u.id, marketId, side: 'yes', action: 'buy', amount: 50 }))
      .rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_BALANCE });
  });

  it('market SELL fills against best bids, credits proceeds minus 0.5% and un-reserves the unfilled part', async () => {
    const bidder = await createUser();
    const seller = await createUser();
    const marketId = await createMarket(bidder.id);
    await giveShares(seller.id, marketId, 'yes', 20);
    await ob.service.placeOrder(bidder.id, marketId, { side: 'yes', action: 'buy', price: 0.4, quantity: 10 });

    const r = await ob.service.executeMarketTrade({ userId: seller.id, marketId, side: 'yes', action: 'sell', amount: 15 });

    expect(r.sharesTransacted).toBeCloseTo(10, 8);
    expect(r.totalCost).toBeCloseTo(4 * (1 - FEE), 8); // proceeds
    expect((await balanceOf(seller.id)).available).toBeCloseTo(1000 + 4 * (1 - FEE), 8);
    expect(await positionOf(seller.id, marketId, 'yes')).toMatchObject({ quantity: 10, reserved: 0 });
    expect(await positionOf(bidder.id, marketId, 'yes')).toMatchObject({ quantity: 10 });
    expect(await balanceOf(bidder.id)).toMatchObject({ reserved: 0 });
  });

  it('market SELL with more shares than owned is rejected', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id);
    await giveShares(u.id, marketId, 'no', 3);
    await expect(ob.service.executeMarketTrade({ userId: u.id, marketId, side: 'no', action: 'sell', amount: 5 }))
      .rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_SHARES });
  });

  // BUG-03: known defect, see docs/test-report/README.md. it.failing passes while the bug exists;
  // once the bug is fixed this test starts failing -> switch it back to it(...).
  it.failing('[BUG-03] a market BUY never fills against the same user\'s resting SELL order (no wash trades)', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id);
    await giveShares(u.id, marketId, 'yes', 10);
    await ob.service.placeOrder(u.id, marketId, { side: 'yes', action: 'sell', price: 0.5, quantity: 10 });

    // amount 3 WX is chosen so that the decimal rounding defect (see next test) does not interfere
    await ob.service.executeMarketTrade({ userId: u.id, marketId, side: 'yes', action: 'buy', amount: 3 }).catch(() => undefined);

    const selfTrades = await db('trades').whereRaw('buyer_id = seller_id');
    expect(selfTrades).toHaveLength(0);
  });

  // BUG-04: known defect, see docs/test-report/README.md. it.failing passes while the bug exists;
  // once the bug is fixed this test starts failing -> switch it back to it(...).
  it.failing('[BUG-04] market BUY where the budget is the binding constraint is executed (2 WX against an ask 10 @0.50)', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const marketId = await createMarket(seller.id);
    await giveShares(seller.id, marketId, 'yes', 10);
    await ob.service.placeOrder(seller.id, marketId, { side: 'yes', action: 'sell', price: 0.5, quantity: 10 });

    const r = await ob.service.executeMarketTrade({ userId: buyer.id, marketId, side: 'yes', action: 'buy', amount: 2 });
    expect(r.sharesTransacted).toBeCloseTo(2 / (0.5 * (1 + FEE)), 6); // ~3.98 shares
  });
});

describe('OrderBookService — market resolution', () => {
  let ob: ReturnType<typeof makeOrderBook>;
  beforeEach(() => {
    ob = makeOrderBook();
  });
  afterEach(async () => {
    await settle(50);
  });

  async function mintedMarket() {
    const exchange = await createExchange(0);
    const yesHolder = await createUser();
    const noHolder = await createUser();
    const marketId = await createMarket(yesHolder.id);
    await ob.service.placeOrder(yesHolder.id, marketId, { side: 'yes', action: 'buy', price: 0.6, quantity: 10 });
    await ob.service.placeOrder(noHolder.id, marketId, { side: 'no', action: 'buy', price: 0.4, quantity: 10 });
    return { exchange, yesHolder, noHolder, marketId };
  }

  it('YES outcome pays 1.0 WX per winning share from the collateral pool, zeroes positions and cancels resting orders', async () => {
    const { yesHolder, noHolder, marketId } = await mintedMarket();
    const resting = await createUser();
    await ob.service.placeOrder(resting.id, marketId, { side: 'yes', action: 'buy', price: 0.2, quantity: 5 });
    const yesBefore = (await balanceOf(yesHolder.id)).available;
    const noBefore = (await balanceOf(noHolder.id)).available;

    const r = await ob.service.resolveMarket(marketId, 'yes', yesHolder.id, 'integration test');

    expect(r).toEqual({ totalPayouts: 10, winnersCount: 1 });
    expect((await balanceOf(yesHolder.id)).available).toBeCloseTo(yesBefore + 10, 8);
    expect((await balanceOf(noHolder.id)).available).toBeCloseTo(noBefore, 8);
    expect(await balanceOf(resting.id)).toMatchObject({ available: 1000, reserved: 0 });
    const market = await db('markets').where('id', marketId).first();
    expect(market.status).toBe('resolved');
    expect(market.outcome).toBe('yes');
    expect(Number(market.liquidity_total)).toBeCloseTo(0, 8);
    expect(await positionOf(yesHolder.id, marketId, 'yes')).toMatchObject({ quantity: 0 });
    expect(ob.notifications.notifyResolved).toHaveBeenCalledWith(expect.objectContaining({ marketId, outcome: 'yes' }));
  });

  it('a market cannot be resolved twice (MARKET_ALREADY_RESOLVED); unknown market -> 404', async () => {
    const { yesHolder, marketId } = await mintedMarket();
    await ob.service.resolveMarket(marketId, 'no', yesHolder.id);
    await expect(ob.service.resolveMarket(marketId, 'yes', yesHolder.id)).rejects.toMatchObject({ code: ErrorCode.MARKET_ALREADY_RESOLVED });
    await expect(ob.service.resolveMarket('00000000-0000-0000-0000-000000000000', 'yes', yesHolder.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('INVALID outcome refunds every participant his net principal (fees excluded)', async () => {
    const { yesHolder, noHolder, marketId } = await mintedMarket();
    const r = await ob.service.resolveMarket(marketId, 'invalid', yesHolder.id);

    expect(r.totalPayouts).toBeCloseTo(10, 8); // 6 + 4
    expect((await balanceOf(yesHolder.id)).available).toBeCloseTo(1000 - 6 * FEE, 8);
    expect((await balanceOf(noHolder.id)).available).toBeCloseTo(1000 - 4 * FEE, 8);
  });
});
