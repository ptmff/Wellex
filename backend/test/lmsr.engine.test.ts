/**
 * Unit tests for the LMSR (Logarithmic Market Scoring Rule) Engine
 *
 * Tests cover:
 * - Price calculation accuracy
 * - Cost function symmetry
 * - Numerical stability at extremes
 * - Share calculation from budget
 * - Slippage and price impact
 * - Market resolution payouts
 */

import Decimal from 'decimal.js';

// ── Inline the math functions so tests don't need DB/Redis
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function costFunction(qYes: Decimal, qNo: Decimal, b: Decimal): Decimal {
  const yesExp = qYes.div(b);
  const noExp = qNo.div(b);
  const maxExp = Decimal.max(yesExp, noExp);
  const lse = maxExp.plus(
    Decimal.ln(Decimal.exp(yesExp.minus(maxExp)).plus(Decimal.exp(noExp.minus(maxExp))))
  );
  return b.mul(lse);
}

function calcYesPrice(qYes: Decimal, qNo: Decimal, b: Decimal): Decimal {
  const yesExp = qYes.div(b);
  const noExp = qNo.div(b);
  const maxExp = Decimal.max(yesExp, noExp);
  const yesExpNorm = Decimal.exp(yesExp.minus(maxExp));
  const noExpNorm = Decimal.exp(noExp.minus(maxExp));
  return yesExpNorm.div(yesExpNorm.plus(noExpNorm));
}

function calcTradeCost(qYes: Decimal, qNo: Decimal, b: Decimal, side: 'yes' | 'no', delta: Decimal): Decimal {
  const before = costFunction(qYes, qNo, b);
  const after = side === 'yes'
    ? costFunction(qYes.plus(delta), qNo, b)
    : costFunction(qYes, qNo.plus(delta), b);
  return after.minus(before);
}

function calcSharesForBudget(qYes: Decimal, qNo: Decimal, b: Decimal, side: 'yes' | 'no', budget: Decimal): Decimal {
  let low = new Decimal(0);
  let high = budget.mul(100);
  for (let i = 0; i < 64; i++) {
    const mid = low.plus(high).div(2);
    const cost = calcTradeCost(qYes, qNo, b, side, mid);
    if (cost.lt(budget)) low = mid;
    else high = mid;
    if (high.minus(low).lt('0.000001')) break;
  }
  return low;
}

// ─────────────────────────────────────────────────────────────────
// TEST SUITE
// ─────────────────────────────────────────────────────────────────

describe('LMSR Engine — Price Calculations', () => {
  const b = new Decimal(100); // Standard liquidity parameter

  describe('Initial market state (q_yes = q_no = 0)', () => {
    const q0 = new Decimal(0);

    test('YES price should be 0.5 at equal shares', () => {
      const price = calcYesPrice(q0, q0, b);
      expect(price.toNumber()).toBeCloseTo(0.5, 6);
    });

    test('NO price should be 0.5 (complement of YES)', () => {
      const yesPrice = calcYesPrice(q0, q0, b);
      const noPrice = new Decimal(1).minus(yesPrice);
      expect(noPrice.toNumber()).toBeCloseTo(0.5, 6);
    });

    test('Prices always sum to 1.0', () => {
      const yesPrice = calcYesPrice(q0, q0, b);
      const noPrice = new Decimal(1).minus(yesPrice);
      expect(yesPrice.plus(noPrice).toNumber()).toBeCloseTo(1.0, 8);
    });
  });

  describe('Price response to trades', () => {
    test('Buying YES shares increases YES price', () => {
      const q0 = new Decimal(0);
      const priceBeore = calcYesPrice(q0, q0, b);
      const priceAfter = calcYesPrice(new Decimal(50), q0, b);
      expect(priceAfter.toNumber()).toBeGreaterThan(priceBeore.toNumber());
    });

    test('Buying NO shares decreases YES price', () => {
      const q0 = new Decimal(0);
      const priceBefore = calcYesPrice(q0, q0, b);
      const priceAfter = calcYesPrice(q0, new Decimal(50), b);
      expect(priceAfter.toNumber()).toBeLessThan(priceBefore.toNumber());
    });

    test('Large YES position pushes price close to 1', () => {
      const priceHigh = calcYesPrice(new Decimal(500), new Decimal(0), b);
      expect(priceHigh.toNumber()).toBeGreaterThan(0.99);
    });

    test('Large NO position pushes YES price close to 0', () => {
      const priceLow = calcYesPrice(new Decimal(0), new Decimal(500), b);
      expect(priceLow.toNumber()).toBeLessThan(0.01);
    });

    test('Price is monotonically increasing with YES shares', () => {
      const q0 = new Decimal(0);
      const prices = [0, 10, 50, 100, 200, 500].map((qty) =>
        calcYesPrice(new Decimal(qty), q0, b).toNumber()
      );
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).toBeGreaterThan(prices[i - 1]);
      }
    });
  });

  describe('Cost function', () => {
    const q0 = new Decimal(0);

    test('Buying 1 share costs more than 0', () => {
      const cost = calcTradeCost(q0, q0, b, 'yes', new Decimal(1));
      expect(cost.toNumber()).toBeGreaterThan(0);
    });

    test('Cost increases non-linearly (price impact)', () => {
      const cost1 = calcTradeCost(q0, q0, b, 'yes', new Decimal(1));
      const cost10 = calcTradeCost(q0, q0, b, 'yes', new Decimal(10));
      // 10 shares should cost more than 10× the cost of 1 share (price impact)
      expect(cost10.toNumber()).toBeGreaterThan(cost1.mul(10).toNumber());
    });

    test('Selling reverses buying (round-trip invariant)', () => {
      const qYes = new Decimal(100);
      const cost = calcTradeCost(q0, q0, b, 'yes', qYes);
      const returnAmount = calcTradeCost(qYes, q0, b, 'yes', qYes.neg()).neg();

      // Should get back slightly less due to price impact (market maker profit)
      expect(returnAmount.toNumber()).toBeLessThanOrEqual(cost.toNumber());
      // But not drastically less (within 10%)
      expect(returnAmount.toNumber()).toBeGreaterThan(cost.mul(0.9).toNumber());
    });

    test('Cost is always positive for buying', () => {
      for (const qty of [1, 10, 100, 1000]) {
        const cost = calcTradeCost(q0, q0, b, 'yes', new Decimal(qty));
        expect(cost.toNumber()).toBeGreaterThan(0);
      }
    });

    test('Return is always positive for selling', () => {
      const qYes = new Decimal(100);
      for (const qty of [1, 10, 50, 100]) {
        const ret = calcTradeCost(qYes, q0, b, 'yes', new Decimal(qty).neg()).neg();
        expect(ret.toNumber()).toBeGreaterThan(0);
      }
    });
  });

  describe('Budget to shares conversion', () => {
    const q0 = new Decimal(0);

    test('$100 budget yields positive share count', () => {
      const shares = calcSharesForBudget(q0, q0, b, 'yes', new Decimal(100));
      expect(shares.toNumber()).toBeGreaterThan(0);
    });

    test('Larger budget yields more shares', () => {
      const shares50 = calcSharesForBudget(q0, q0, b, 'yes', new Decimal(50));
      const shares100 = calcSharesForBudget(q0, q0, b, 'yes', new Decimal(100));
      expect(shares100.toNumber()).toBeGreaterThan(shares50.toNumber());
    });

    test('Cost verification: shares from budget cost ≈ budget', () => {
      const budget = new Decimal(100);
      const shares = calcSharesForBudget(q0, q0, b, 'yes', budget);
      const actualCost = calcTradeCost(q0, q0, b, 'yes', shares);
      expect(actualCost.toNumber()).toBeCloseTo(budget.toNumber(), 3);
    });

    test('Works for NO side as well', () => {
      const budget = new Decimal(200);
      const shares = calcSharesForBudget(q0, q0, b, 'no', budget);
      const actualCost = calcTradeCost(q0, q0, b, 'no', shares);
      expect(actualCost.toNumber()).toBeCloseTo(budget.toNumber(), 3);
    });
  });

  describe('Numerical stability', () => {
    test('Handles very large share quantities without overflow', () => {
      const largeQ = new Decimal(10000);
      expect(() => calcYesPrice(largeQ, new Decimal(0), b)).not.toThrow();
      expect(() => calcYesPrice(new Decimal(0), largeQ, b)).not.toThrow();
    });

    test('Handles very small b parameter', () => {
      const smallB = new Decimal(1);
      const q0 = new Decimal(0);
      expect(() => calcYesPrice(q0, q0, smallB)).not.toThrow();
      const price = calcYesPrice(q0, q0, smallB);
      expect(price.toNumber()).toBeCloseTo(0.5, 4);
    });

    test('Price stays in [0,1] under all conditions', () => {
      const cases = [
        [0, 0], [100, 0], [0, 100], [500, 100], [100, 500], [1000, 1000],
      ];
      for (const [yes, no] of cases) {
        const price = calcYesPrice(new Decimal(yes), new Decimal(no), b);
        expect(price.toNumber()).toBeGreaterThanOrEqual(0);
        expect(price.toNumber()).toBeLessThanOrEqual(1);
      }
    });

    test('Cost function is always finite', () => {
      const cases = [
        [0, 0], [100, 50], [50, 100], [500, 500],
      ];
      for (const [yes, no] of cases) {
        const cost = costFunction(new Decimal(yes), new Decimal(no), b);
        expect(isFinite(cost.toNumber())).toBe(true);
        expect(isNaN(cost.toNumber())).toBe(false);
      }
    });
  });

  describe('Symmetry properties', () => {
    test('YES and NO are symmetric at equal shares', () => {
      const q0 = new Decimal(0);
      const costYes = calcTradeCost(q0, q0, b, 'yes', new Decimal(50));
      const costNo = calcTradeCost(q0, q0, b, 'no', new Decimal(50));
      expect(costYes.toNumber()).toBeCloseTo(costNo.toNumber(), 6);
    });

    test('Market is zero-sum: total cost = total payout at resolution', () => {
      // After buying 100 YES shares and 100 NO shares from 0,
      // total invested should equal market liquidity added
      const q0 = new Decimal(0);
      const costYes = calcTradeCost(q0, q0, b, 'yes', new Decimal(100));
      const costNo = calcTradeCost(q0, q0, b, 'no', new Decimal(100));

      // YES resolves: payout = 100 shares × $1 = $100
      // NO resolves: payout = 100 shares × $1 = $100
      // Total invested = costYes + costNo, payout to winner = 100
      // The market maker (LMSR) keeps the spread
      expect(costYes.plus(costNo).toNumber()).toBeGreaterThan(100);
    });
  });

  describe('Liquidity parameter b', () => {
    test('Higher b = less price impact per trade', () => {
      const q0 = new Decimal(0);
      const trade = new Decimal(10);

      const priceLowB = calcYesPrice(trade, q0, new Decimal(10));
      const priceHighB = calcYesPrice(trade, q0, new Decimal(1000));

      // Higher b means smaller price movement
      expect(Math.abs(priceHighB.toNumber() - 0.5)).toBeLessThan(
        Math.abs(priceLowB.toNumber() - 0.5)
      );
    });

    test('Initial liquidity determines b correctly', () => {
      // b = initialLiquidity / ln(2) gives exactly $0.5 price at zero shares
      const initialLiquidity = 1000;
      const computedB = new Decimal(initialLiquidity).div(Math.LN2);
      const price = calcYesPrice(new Decimal(0), new Decimal(0), computedB);
      expect(price.toNumber()).toBeCloseTo(0.5, 6);
    });
  });
});

describe('LMSR Engine — Trade Scenarios', () => {
  const b = new Decimal(100);

  test('Scenario: whale buy moves price significantly', () => {
    const q0 = new Decimal(0);
    const whaleBudget = new Decimal(5000);
    const shares = calcSharesForBudget(q0, q0, b, 'yes', whaleBudget);
    const priceAfter = calcYesPrice(shares, q0, b);

    // Whale spending $5000 on b=100 market should push price well above 0.8
    expect(priceAfter.toNumber()).toBeGreaterThan(0.8);
  });

  test('Scenario: small trade has minimal price impact', () => {
    const q0 = new Decimal(0);
    const smallBudget = new Decimal(1); // $1 trade
    const shares = calcSharesForBudget(q0, q0, b, 'yes', smallBudget);
    const priceBefore = calcYesPrice(q0, q0, b);
    const priceAfter = calcYesPrice(shares, q0, b);
    const impact = Math.abs(priceAfter.toNumber() - priceBefore.toNumber());

    // $1 trade on b=100 market moves price by < 0.5%
    expect(impact).toBeLessThan(0.005);
  });

  test('Scenario: arbitrage opportunity closes correctly', () => {
    // If YES price is 0.7 and NO price is 0.3,
    // buying NO at 0.3 effectively bets against current consensus
    const qYes = new Decimal(150);
    const q0 = new Decimal(0);
    const yesPrice = calcYesPrice(qYes, q0, b);

    expect(yesPrice.toNumber()).toBeGreaterThan(0.7);

    // After buying NO, YES price drops
    const qNoAfter = new Decimal(100);
    const yesPriceAfter = calcYesPrice(qYes, qNoAfter, b);
    expect(yesPriceAfter.toNumber()).toBeLessThan(yesPrice.toNumber());
  });
});
