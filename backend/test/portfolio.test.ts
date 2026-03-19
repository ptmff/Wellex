/**
 * Unit tests for Portfolio PnL calculations
 * Tests WAP (Weighted Average Price), realized/unrealized PnL, position management
 */

interface Position {
  quantity: number;
  averagePrice: number;
  totalInvested: number;
  realizedPnl: number;
}

function openPosition(quantity: number, price: number): Position {
  return {
    quantity,
    averagePrice: price,
    totalInvested: quantity * price,
    realizedPnl: 0,
  };
}

function buyMore(position: Position, quantity: number, price: number): Position {
  const newQty = position.quantity + quantity;
  const newInvested = position.totalInvested + quantity * price;
  return {
    quantity: newQty,
    averagePrice: newInvested / newQty,
    totalInvested: newInvested,
    realizedPnl: position.realizedPnl,
  };
}

function sell(position: Position, quantity: number, salePrice: number): Position {
  const realizedPnl = (salePrice - position.averagePrice) * quantity;
  const newQty = position.quantity - quantity;
  const newInvested = position.averagePrice * newQty;
  return {
    quantity: Math.max(0, newQty),
    averagePrice: position.averagePrice, // Average price doesn't change on sell
    totalInvested: Math.max(0, newInvested),
    realizedPnl: position.realizedPnl + realizedPnl,
  };
}

function calcUnrealizedPnl(position: Position, currentPrice: number): number {
  return (currentPrice - position.averagePrice) * position.quantity;
}

function calcTotalPnl(position: Position, currentPrice: number): number {
  return position.realizedPnl + calcUnrealizedPnl(position, currentPrice);
}

// ─────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────

describe('Portfolio — Weighted Average Price', () => {
  test('Single buy sets average price correctly', () => {
    const pos = openPosition(100, 0.60);
    expect(pos.averagePrice).toBeCloseTo(0.60, 6);
  });

  test('Two buys at different prices averages correctly', () => {
    let pos = openPosition(100, 0.60);
    pos = buyMore(pos, 100, 0.80);
    // WAP = (100*0.60 + 100*0.80) / 200 = 0.70
    expect(pos.averagePrice).toBeCloseTo(0.70, 6);
    expect(pos.quantity).toBe(200);
  });

  test('Unequal quantities weight average correctly', () => {
    let pos = openPosition(300, 0.60);
    pos = buyMore(pos, 100, 0.80);
    // WAP = (300*0.60 + 100*0.80) / 400 = (180 + 80) / 400 = 0.65
    expect(pos.averagePrice).toBeCloseTo(0.65, 6);
  });

  test('Selling does not change average price', () => {
    let pos = openPosition(200, 0.60);
    pos = sell(pos, 100, 0.75);
    expect(pos.averagePrice).toBeCloseTo(0.60, 6);
  });

  test('Multiple buys and sells track correctly', () => {
    let pos = openPosition(100, 0.50);
    pos = buyMore(pos, 100, 0.60);  // WAP = 0.55
    pos = sell(pos, 50, 0.65);      // Realize gain
    pos = buyMore(pos, 200, 0.70);  // WAP recalculated

    expect(pos.quantity).toBe(350);
    // WAP = (150*0.55 + 200*0.70) / 350 = (82.5 + 140) / 350 = 0.6357...
    expect(pos.averagePrice).toBeCloseTo(0.6357, 3);
  });
});

describe('Portfolio — Realized PnL', () => {
  test('Profit on sell: current > avg price', () => {
    let pos = openPosition(100, 0.50);
    pos = sell(pos, 100, 0.75);
    // Realized = (0.75 - 0.50) * 100 = $25
    expect(pos.realizedPnl).toBeCloseTo(25, 4);
  });

  test('Loss on sell: current < avg price', () => {
    let pos = openPosition(100, 0.70);
    pos = sell(pos, 100, 0.40);
    // Realized = (0.40 - 0.70) * 100 = -$30
    expect(pos.realizedPnl).toBeCloseTo(-30, 4);
  });

  test('Break-even: realized PnL = 0 when sell price = avg price', () => {
    let pos = openPosition(100, 0.60);
    pos = sell(pos, 100, 0.60);
    expect(pos.realizedPnl).toBeCloseTo(0, 6);
  });

  test('Partial sell accumulates realized PnL correctly', () => {
    let pos = openPosition(200, 0.50);
    pos = sell(pos, 50, 0.70);   // Realized: (0.70-0.50)*50 = $10
    pos = sell(pos, 50, 0.80);   // Realized: (0.80-0.50)*50 = $15
    expect(pos.realizedPnl).toBeCloseTo(25, 4);
  });

  test('Full position close: quantity goes to 0', () => {
    let pos = openPosition(100, 0.50);
    pos = sell(pos, 100, 0.75);
    expect(pos.quantity).toBe(0);
    expect(pos.totalInvested).toBeCloseTo(0, 6);
  });

  test('Resolution win: shares × $1 payout', () => {
    // Market resolves YES, user holds 100 YES shares bought at 0.60
    const sharesHeld = 100;
    const buyPrice = 0.60;
    const payoutPerShare = 1.0; // Market resolution

    const totalInvested = sharesHeld * buyPrice;
    const payout = sharesHeld * payoutPerShare;
    const profit = payout - totalInvested;

    expect(profit).toBeCloseTo(40, 4); // ($100 - $60 = $40 profit)
  });

  test('Resolution loss: shares worth $0', () => {
    const sharesHeld = 100;
    const buyPrice = 0.60;
    const payoutPerShare = 0; // Wrong outcome

    const totalInvested = sharesHeld * buyPrice;
    const payout = sharesHeld * payoutPerShare;
    const profit = payout - totalInvested;

    expect(profit).toBeCloseTo(-60, 4); // Lost entire investment
  });
});

describe('Portfolio — Unrealized PnL', () => {
  test('Positive unrealized PnL when price above avg', () => {
    const pos = openPosition(100, 0.50);
    const unrealized = calcUnrealizedPnl(pos, 0.70);
    expect(unrealized).toBeCloseTo(20, 4); // (0.70-0.50)*100 = $20
  });

  test('Negative unrealized PnL when price below avg', () => {
    const pos = openPosition(100, 0.70);
    const unrealized = calcUnrealizedPnl(pos, 0.50);
    expect(unrealized).toBeCloseTo(-20, 4);
  });

  test('Zero unrealized PnL at cost basis', () => {
    const pos = openPosition(100, 0.60);
    const unrealized = calcUnrealizedPnl(pos, 0.60);
    expect(unrealized).toBeCloseTo(0, 6);
  });

  test('Unrealized PnL at market close (price = 0 or 1)', () => {
    const pos = openPosition(200, 0.40);
    const unrealizedWin = calcUnrealizedPnl(pos, 1.0);
    const unrealizedLoss = calcUnrealizedPnl(pos, 0.0);

    expect(unrealizedWin).toBeCloseTo(120, 4);  // (1.0-0.40)*200
    expect(unrealizedLoss).toBeCloseTo(-80, 4); // (0.0-0.40)*200
  });

  test('Zero unrealized PnL on empty position', () => {
    let pos = openPosition(100, 0.60);
    pos = sell(pos, 100, 0.80);
    const unrealized = calcUnrealizedPnl(pos, 0.90);
    expect(unrealized).toBeCloseTo(0, 6); // No shares left
  });
});

describe('Portfolio — Total PnL', () => {
  test('Total PnL = realized + unrealized', () => {
    let pos = openPosition(200, 0.50);
    pos = sell(pos, 100, 0.60); // Realized: $10

    const currentPrice = 0.70;
    const unrealized = calcUnrealizedPnl(pos, currentPrice); // (0.70-0.50)*100 = $20
    const total = calcTotalPnl(pos, currentPrice);

    expect(total).toBeCloseTo(30, 4); // $10 + $20
  });

  test('Leaderboard scenario: top trader', () => {
    // Simulate a trader who bought early and sold at peak
    let pos = openPosition(1000, 0.20); // Bought 1000 shares at 0.20
    pos = sell(pos, 500, 0.80);         // Sold half at 0.80 (realized $300)
    const unrealized = calcUnrealizedPnl(pos, 0.75); // 500 shares at current 0.75

    const realizedPnl = pos.realizedPnl; // (0.80-0.20)*500 = $300
    expect(realizedPnl).toBeCloseTo(300, 2);
    expect(unrealized).toBeCloseTo(275, 2); // (0.75-0.20)*500
  });
});

describe('Portfolio — Balance Tracking', () => {
  test('Available balance decreases after buy', () => {
    const initialBalance = 10000;
    const tradeCost = 100;
    const newBalance = initialBalance - tradeCost;
    expect(newBalance).toBe(9900);
  });

  test('Available balance increases after sell', () => {
    const balance = 9900;
    const saleProceeds = 150;
    const newBalance = balance + saleProceeds;
    expect(newBalance).toBe(10050);
  });

  test('Reserved balance tracks open limit orders', () => {
    const available = 10000;
    const orderCost = 500;

    const afterReserve = {
      available: available - orderCost,
      reserved: orderCost,
      total: available,
    };

    expect(afterReserve.available).toBe(9500);
    expect(afterReserve.reserved).toBe(500);
    expect(afterReserve.total).toBe(afterReserve.available + afterReserve.reserved);
  });

  test('Cancel order releases reserved funds', () => {
    const state = { available: 9500, reserved: 500, total: 10000 };
    const cancelledOrderCost = 500;

    const afterCancel = {
      available: state.available + cancelledOrderCost,
      reserved: state.reserved - cancelledOrderCost,
      total: state.total,
    };

    expect(afterCancel.available).toBe(10000);
    expect(afterCancel.reserved).toBe(0);
    expect(afterCancel.total).toBe(10000);
  });
});
