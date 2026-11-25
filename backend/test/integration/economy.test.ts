/**
 * EconomyService + wallet (src/modules/economy/*): daily bonus with streaks, rewarded-ad sessions
 * stored in Redis, cooldown and daily limits, mock purchases.
 */
import Decimal from 'decimal.js';
import { db } from '../../src/database/connection';
import { redisClient } from '../../src/infrastructure/redis/cache.service';
import { EconomyService } from '../../src/modules/economy/economy.service';
import { creditWx, debitWx } from '../../src/modules/economy/wallet';
import { ErrorCode } from '../../src/common/errors';
import { config } from '../../src/config';
import { balanceOf, createUser } from '../helpers/db';

const economy = new EconomyService();

function utcDate(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function ageAdSession(sessionId: string, seconds: number) {
  const key = `pm:adsession:${sessionId}`;
  const s = JSON.parse((await redisClient.get(key))!);
  s.createdAt -= seconds * 1000;
  await redisClient.set(key, JSON.stringify(s), 'KEEPTTL');
}

describe('EconomyService — daily bonus', () => {
  it('first claim credits DAILY_BONUS_AMOUNT (25 WX) with streak 1; second claim the same day is rejected', async () => {
    const u = await createUser();
    const r = await economy.claimDailyBonus(u.id);
    expect(r).toMatchObject({ wxAmount: config.DAILY_BONUS_AMOUNT, streak: 1, available: 1000 + config.DAILY_BONUS_AMOUNT });

    await expect(economy.claimDailyBonus(u.id)).rejects.toMatchObject({ code: ErrorCode.RATE_LIMITED, statusCode: 429 });
    expect((await balanceOf(u.id)).available).toBe(1000 + config.DAILY_BONUS_AMOUNT);
    const tx = await db('balance_transactions').where({ user_id: u.id, type: 'daily_bonus' });
    expect(tx).toHaveLength(1);
    const status = await economy.getDailyBonusAvailability(u.id);
    expect(status).toMatchObject({ canClaim: false, streak: 1, claimedOn: utcDate() });
  });

  it('claiming on consecutive days increases the streak', async () => {
    const u = await createUser();
    await db('daily_bonus_claims').insert({ user_id: u.id, claimed_on: utcDate(-1), streak: 3, wx_amount: '25' });
    expect(await economy.getDailyBonusAvailability(u.id)).toMatchObject({ canClaim: true, streak: 3 });
    const r = await economy.claimDailyBonus(u.id);
    expect(r.streak).toBe(4);
  });

  it('concurrent claims are serialized: exactly one of 5 parallel requests succeeds', async () => {
    const u = await createUser();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => economy.claimDailyBonus(u.id)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await balanceOf(u.id)).available).toBe(1000 + config.DAILY_BONUS_AMOUNT);
  });
});

describe('EconomyService — rewarded ad sessions', () => {
  it('session is stored in Redis with TTL 600s; a premature claim is rejected without burning the session', async () => {
    const u = await createUser();
    const s = await economy.startAdSession(u.id);
    expect(s).toMatchObject({ provider: 'mock', rewardAmount: config.AD_REWARD_AMOUNT, expiresInSeconds: 600 });
    const ttl = await redisClient.ttl(`pm:adsession:${s.sessionId}`);
    expect(ttl).toBeGreaterThan(590);

    await expect(economy.claimAdReward(u.id, { sessionId: s.sessionId })).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, message: 'Ad was not watched long enough' });
    expect(await redisClient.exists(`pm:adsession:${s.sessionId}`)).toBe(1);
  });

  it('after the minimum watch time the reward is credited once; the session cannot be reused', async () => {
    const u = await createUser();
    const s = await economy.startAdSession(u.id);
    await ageAdSession(s.sessionId, config.AD_MIN_WATCH_SECONDS + 1);

    const r = await economy.claimAdReward(u.id, { sessionId: s.sessionId });
    expect(r).toMatchObject({ wxAmount: config.AD_REWARD_AMOUNT, available: 1000 + config.AD_REWARD_AMOUNT });
    await expect(economy.claimAdReward(u.id, { sessionId: s.sessionId })).rejects.toMatchObject({ message: 'Ad session is invalid or expired' });
    expect(await db('ad_rewards').where({ user_id: u.id })).toHaveLength(1);
  });

  it('a session of another user is rejected with 403', async () => {
    const owner = await createUser();
    const thief = await createUser();
    const s = await economy.startAdSession(owner.id);
    await ageAdSession(s.sessionId, config.AD_MIN_WATCH_SECONDS + 1);
    await expect(economy.claimAdReward(thief.id, { sessionId: s.sessionId })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('cooldown after a reward and the daily limit block new sessions (429)', async () => {
    const u = await createUser();
    await db('ad_rewards').insert({ user_id: u.id, wx_amount: '100', provider: 'mock' });
    await expect(economy.startAdSession(u.id)).rejects.toMatchObject({ code: ErrorCode.RATE_LIMITED, message: 'Ad reward cooldown active' });

    const v = await createUser();
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 1, 0);
    for (let i = 0; i < config.AD_REWARD_MAX_PER_DAY; i++) {
      await db('ad_rewards').insert({ user_id: v.id, wx_amount: '100', provider: 'mock', created_at: startOfDay });
    }
    await expect(economy.startAdSession(v.id)).rejects.toMatchObject({ message: 'Daily ad reward limit reached' });
  });
});

describe('EconomyService — purchases and wallet', () => {
  it('mock provider purchase of "starter" credits 500 WX immediately; unknown package -> 404', async () => {
    const u = await createUser();
    const r = await economy.purchase(u.id, { packageSlug: 'starter' });
    expect(r).toMatchObject({ status: 'succeeded', wxAmount: 500, provider: 'mock' });
    expect((await balanceOf(u.id)).available).toBe(1500);
    expect((await economy.getPurchase(u.id, r.purchaseId)).status).toBe('succeeded');

    await expect(economy.purchase(u.id, { packageSlug: 'nope' })).rejects.toMatchObject({ statusCode: 404 });
    const other = await createUser();
    await expect(economy.getPurchase(other.id, r.purchaseId)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('status aggregates balance, ad availability and daily bonus', async () => {
    const u = await createUser();
    const s = await economy.getStatus(u.id);
    expect(s).toMatchObject({ currency: 'WX', available: 1000, reserved: 0, total: 1000, paymentProvider: 'mock' });
    expect(s.ad.canWatch).toBe(true);
    expect(s.daily.canClaim).toBe(true);
    expect((await economy.listPackages()).map((p) => p.slug)).toEqual(['starter', 'pack', 'whale']);
  });

  it('creditWx / debitWx keep the ledger consistent and refuse invalid amounts', async () => {
    const u = await createUser({ balance: 10 });
    await db.transaction(async (trx) => {
      const c = await creditWx(trx, u.id, 5, 'adjustment', 'test credit');
      expect(c.balanceAfter.toNumber()).toBe(15);
      const d = await debitWx(trx, u.id, new Decimal(12), 'adjustment', 'test debit');
      expect(d.balanceAfter.toNumber()).toBe(3);
    });
    expect((await balanceOf(u.id)).available).toBe(3);
    await expect(db.transaction((trx) => debitWx(trx, u.id, 4, 'adjustment', 'too much'))).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_BALANCE });
    await expect(db.transaction((trx) => creditWx(trx, u.id, 0, 'adjustment', 'zero'))).rejects.toThrow('Credit amount must be positive');
  });
});
