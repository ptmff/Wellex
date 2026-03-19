/**
 * Unit tests for Order Book Matching Engine
 *
 * Tests the matching logic in isolation without database dependencies.
 */

interface Order {
  id: string;
  userId: string;
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  price: number;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  status: 'open' | 'partially_filled' | 'filled' | 'cancelled';
  createdAt: Date;
}

interface Fill {
  buyOrderId: string;
  sellOrderId: string;
  quantity: number;
  price: number;
}

// ── Inline matching engine (pure function, no side effects)
function matchOrders(
  buys: Order[],
  sells: Order[]
): Fill[] {
  // Sort: buys DESC by price (FIFO within same price), sells ASC by price
  const sortedBuys = [...buys]
    .filter((o) => ['open', 'partially_filled'].includes(o.status))
    .sort((a, b) => b.price - a.price || a.createdAt.getTime() - b.createdAt.getTime());

  const sortedSells = [...sells]
    .filter((o) => ['open', 'partially_filled'].includes(o.status))
    .sort((a, b) => a.price - b.price || a.createdAt.getTime() - b.createdAt.getTime());

  const fills: Fill[] = [];
  const buyState = sortedBuys.map((o) => ({ ...o }));
  const sellState = sortedSells.map((o) => ({ ...o }));

  let bi = 0;
  let si = 0;

  while (bi < buyState.length && si < sellState.length) {
    const buy = buyState[bi];
    const sell = sellState[si];

    if (buy.price < sell.price) break; // No match possible

    const fillPrice = sell.price; // Maker price (seller set the price)
    const fillQty = Math.min(buy.remainingQuantity, sell.remainingQuantity);

    fills.push({
      buyOrderId: buy.id,
      sellOrderId: sell.id,
      quantity: fillQty,
      price: fillPrice,
    });

    buy.remainingQuantity -= fillQty;
    sell.remainingQuantity -= fillQty;
    buy.filledQuantity += fillQty;
    sell.filledQuantity += fillQty;

    if (buy.remainingQuantity <= 0.000001) bi++;
    if (sell.remainingQuantity <= 0.000001) si++;
  }

  return fills;
}

function makeOrder(
  overrides: Partial<Order> & Pick<Order, 'id' | 'userId' | 'action' | 'price' | 'quantity'>
): Order {
  return {
    side: 'yes',
    filledQuantity: 0,
    remainingQuantity: overrides.quantity,
    status: 'open',
    createdAt: new Date(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────

describe('Order Book — Matching Engine', () => {
  describe('Basic matching', () => {
    test('Matching buy and sell at same price produces one fill', () => {
      const buy = makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.65, quantity: 100 });
      const sell = makeOrder({ id: 's1', userId: 'u2', action: 'sell', price: 0.65, quantity: 100 });

      const fills = matchOrders([buy], [sell]);

      expect(fills).toHaveLength(1);
      expect(fills[0].quantity).toBe(100);
      expect(fills[0].price).toBe(0.65);
    });

    test('Buy price > sell price triggers match (bid > ask = crossing)', () => {
      const buy = makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.70, quantity: 50 });
      const sell = makeOrder({ id: 's1', userId: 'u2', action: 'sell', price: 0.65, quantity: 50 });

      const fills = matchOrders([buy], [sell]);

      expect(fills).toHaveLength(1);
      expect(fills[0].quantity).toBe(50);
      expect(fills[0].price).toBe(0.65); // Maker price (seller's)
    });

    test('Buy price < sell price produces no fill (spread)', () => {
      const buy = makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.60, quantity: 50 });
      const sell = makeOrder({ id: 's1', userId: 'u2', action: 'sell', price: 0.65, quantity: 50 });

      const fills = matchOrders([buy], [sell]);

      expect(fills).toHaveLength(0);
    });

    test('No orders on either side produces no fills', () => {
      expect(matchOrders([], [])).toHaveLength(0);
      expect(matchOrders([makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.5, quantity: 10 })], [])).toHaveLength(0);
      expect(matchOrders([], [makeOrder({ id: 's1', userId: 'u2', action: 'sell', price: 0.5, quantity: 10 })])).toHaveLength(0);
    });
  });

  describe('Partial fills', () => {
    test('Large buy partially fills against small sell', () => {
      const buy = makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.65, quantity: 200 });
      const sell = makeOrder({ id: 's1', userId: 'u2', action: 'sell', price: 0.65, quantity: 80 });

      const fills = matchOrders([buy], [sell]);

      expect(fills).toHaveLength(1);
      expect(fills[0].quantity).toBe(80); // Fills up to sell quantity
    });

    test('One buy fills across multiple sells', () => {
      const buy = makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.70, quantity: 300 });
      const sell1 = makeOrder({ id: 's1', userId: 'u2', action: 'sell', price: 0.62, quantity: 100 });
      const sell2 = makeOrder({ id: 's2', userId: 'u3', action: 'sell', price: 0.64, quantity: 100 });
      const sell3 = makeOrder({ id: 's3', userId: 'u4', action: 'sell', price: 0.66, quantity: 100 });

      const fills = matchOrders([buy], [sell1, sell2, sell3]);

      expect(fills).toHaveLength(3);
      expect(fills.reduce((sum, f) => sum + f.quantity, 0)).toBe(300);
      // Fills at maker prices in order: 0.62, 0.64, 0.66
      expect(fills[0].price).toBe(0.62);
      expect(fills[1].price).toBe(0.64);
      expect(fills[2].price).toBe(0.66);
    });

    test('Multiple buys fill against one large sell', () => {
      const buy1 = makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.70, quantity: 100 });
      const buy2 = makeOrder({ id: 'b2', userId: 'u2', action: 'buy', price: 0.68, quantity: 100 });
      const sell = makeOrder({ id: 's1', userId: 'u3', action: 'sell', price: 0.65, quantity: 200 });

      const fills = matchOrders([buy1, buy2], [sell]);

      expect(fills).toHaveLength(2);
      expect(fills[0].buyOrderId).toBe('b1'); // Higher bid matches first
      expect(fills[1].buyOrderId).toBe('b2');
    });
  });

  describe('Price priority (best bid/ask first)', () => {
    test('Highest buy price matches first', () => {
      const buy1 = makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.60, quantity: 100 });
      const buy2 = makeOrder({ id: 'b2', userId: 'u2', action: 'buy', price: 0.70, quantity: 100 });
      const sell = makeOrder({ id: 's1', userId: 'u3', action: 'sell', price: 0.65, quantity: 100 });

      const fills = matchOrders([buy1, buy2], [sell]);

      // Only buy2 (0.70) crosses the sell (0.65); buy1 (0.60) does not
      expect(fills).toHaveLength(1);
      expect(fills[0].buyOrderId).toBe('b2');
    });

    test('Lowest sell price matches first', () => {
      const buy = makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.70, quantity: 200 });
      const sell1 = makeOrder({ id: 's1', userId: 'u2', action: 'sell', price: 0.68, quantity: 100 });
      const sell2 = makeOrder({ id: 's2', userId: 'u3', action: 'sell', price: 0.65, quantity: 100 });

      const fills = matchOrders([buy], [sell1, sell2]);

      expect(fills[0].sellOrderId).toBe('s2'); // Lower ask fills first
      expect(fills[1].sellOrderId).toBe('s1');
    });
  });

  describe('FIFO within same price level', () => {
    test('Earlier order at same price fills first', () => {
      const t1 = new Date('2024-01-01T10:00:00Z');
      const t2 = new Date('2024-01-01T10:01:00Z');

      const buy1 = makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.65, quantity: 100, createdAt: t1 });
      const buy2 = makeOrder({ id: 'b2', userId: 'u2', action: 'buy', price: 0.65, quantity: 100, createdAt: t2 });
      const sell = makeOrder({ id: 's1', userId: 'u3', action: 'sell', price: 0.65, quantity: 100 });

      const fills = matchOrders([buy2, buy1], [sell]); // Intentionally out of order input

      expect(fills[0].buyOrderId).toBe('b1'); // Earlier order fills first
    });
  });

  describe('Edge cases', () => {
    test('Cancelled orders are skipped', () => {
      const buy = makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.65, quantity: 100 });
      const cancelledSell: Order = {
        ...makeOrder({ id: 's1', userId: 'u2', action: 'sell', price: 0.65, quantity: 100 }),
        status: 'cancelled',
      };

      const fills = matchOrders([buy], [cancelledSell]);
      expect(fills).toHaveLength(0);
    });

    test('Filled orders are skipped', () => {
      const buy: Order = {
        ...makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.65, quantity: 100 }),
        status: 'filled',
        remainingQuantity: 0,
      };
      const sell = makeOrder({ id: 's1', userId: 'u2', action: 'sell', price: 0.65, quantity: 100 });

      const fills = matchOrders([buy], [sell]);
      expect(fills).toHaveLength(0);
    });

    test('Total filled quantity never exceeds order quantity', () => {
      const buy = makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.70, quantity: 100 });
      const sells = [
        makeOrder({ id: 's1', userId: 'u2', action: 'sell', price: 0.65, quantity: 60 }),
        makeOrder({ id: 's2', userId: 'u3', action: 'sell', price: 0.66, quantity: 60 }),
      ];

      const fills = matchOrders([buy], sells);
      const totalFilled = fills.reduce((sum, f) => sum + f.quantity, 0);

      expect(totalFilled).toBeLessThanOrEqual(100);
      expect(totalFilled).toBe(100); // Should fill exactly 100 (60 + 40 from second)
    });

    test('Fill price is maker (seller) price, not taker (buyer) price', () => {
      const buy = makeOrder({ id: 'b1', userId: 'u1', action: 'buy', price: 0.80, quantity: 100 });
      const sell = makeOrder({ id: 's1', userId: 'u2', action: 'sell', price: 0.65, quantity: 100 });

      const fills = matchOrders([buy], [sell]);

      expect(fills[0].price).toBe(0.65); // Seller's price, not buyer's 0.80
    });
  });
});

describe('Order Book — Spread Calculation', () => {
  function calcSpread(bids: number[], asks: number[]): number | null {
    if (bids.length === 0 || asks.length === 0) return null;
    const bestBid = Math.max(...bids);
    const bestAsk = Math.min(...asks);
    return bestAsk - bestBid;
  }

  test('Spread is positive when ask > bid', () => {
    const spread = calcSpread([0.60, 0.62], [0.65, 0.68]);
    expect(spread).toBeGreaterThan(0);
    expect(spread).toBeCloseTo(0.03, 5);
  });

  test('Zero spread when bid = ask (instant match)', () => {
    const spread = calcSpread([0.65], [0.65]);
    expect(spread).toBe(0);
  });

  test('Null spread with empty order book', () => {
    expect(calcSpread([], [])).toBeNull();
    expect(calcSpread([0.65], [])).toBeNull();
    expect(calcSpread([], [0.65])).toBeNull();
  });

  test('Negative spread indicates crossed book (arbitrage opportunity)', () => {
    // This shouldn't happen after matching, but let's verify the math
    const spread = calcSpread([0.70], [0.65]); // Bid > Ask
    expect(spread).toBeLessThan(0);
  });
});
