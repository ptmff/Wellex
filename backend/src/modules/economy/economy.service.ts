import { z } from 'zod';
import Decimal from 'decimal.js';
import type { Knex } from 'knex';
import { db } from '../../database/connection';
import { config } from '../../config';
import { AppError, ErrorCode, ForbiddenError, NotFoundError } from '../../common/errors';
import { logger } from '../../common/logger';
import { randomUUID } from 'crypto';
import { creditWx } from './wallet';
import { paymentProvider } from './payment.provider';
import { portfolioCache, redisClient } from '../../infrastructure/redis/cache.service';

export const PurchaseDto = z.object({
  packageSlug: z.string().min(1).max(50),
});

export const AdRewardClaimDto = z.object({
  sessionId: z.string().uuid(),
});

const AD_SESSION_TTL_SECONDS = 600;
const adSessionKey = (sessionId: string) => `pm:adsession:${sessionId}`;

type AdSession = {
  userId: string;
  createdAt: number;
};

export const YooKassaWebhookDto = z.object({
  type: z.string().optional(),
  event: z.string().min(1),
  object: z.object({
    id: z.string().min(1),
    status: z.string().optional(),
    metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
});

const DEFAULT_PACKAGES = [
  { slug: 'starter', name: 'Starter', wx_amount: '500', price_rub: '49.00', sort_order: 1 },
  { slug: 'pack', name: 'Pack', wx_amount: '2000', price_rub: '149.00', sort_order: 2 },
  { slug: 'whale', name: 'Whale', wx_amount: '5000', price_rub: '299.00', sort_order: 3 },
];

type PurchaseRow = {
  id: string;
  user_id: string;
  package_id: string;
  wx_amount: string;
  price_rub: string;
  provider: string;
  provider_ref: string | null;
  status: string;
  metadata: unknown;
  created_at: Date;
  completed_at: Date | null;
};

export class EconomyService {
  async ensurePackages(): Promise<void> {
    await db('coin_packages').insert(DEFAULT_PACKAGES).onConflict('slug').ignore();
  }

  async listPackages() {
    await this.ensurePackages();
    const rows = await db('coin_packages').where('is_active', true).orderBy('sort_order', 'asc');
    return rows.map((p) => this.formatPackage(p));
  }

  async getStatus(userId: string) {
    const balance = await db('balances').where('user_id', userId).first();
    if (!balance) throw new NotFoundError('Balance', userId);

    const available = parseFloat(String(balance.available_cash ?? balance.available ?? 0));
    const ad = await this.getAdAvailability(userId);

    return {
      currency: config.CURRENCY_CODE,
      available,
      reserved: parseFloat(String(balance.reserved_cash ?? balance.reserved ?? 0)),
      total: parseFloat(
        String(
          new Decimal(balance.available_cash ?? balance.available ?? 0).plus(
            new Decimal(balance.reserved_cash ?? balance.reserved ?? 0)
          )
        )
      ),
      paymentProvider: paymentProvider.name,
      ad: {
        ...ad,
        provider: config.AD_PROVIDER,
        minWatchSeconds: config.AD_MIN_WATCH_SECONDS,
      },
      daily: await this.getDailyBonusAvailability(userId),
    };
  }

  async purchase(userId: string, input: z.infer<typeof PurchaseDto>) {
    const { packageSlug } = PurchaseDto.parse(input);
    await this.ensurePackages();

    const pack = await db('coin_packages').where({ slug: packageSlug, is_active: true }).first();
    if (!pack) throw new NotFoundError('Package', packageSlug);

    const user = await db('users').select('id', 'email').where('id', userId).first();
    if (!user) throw new NotFoundError('User', userId);

    const [row] = await db('coin_purchases')
      .insert({
        user_id: userId,
        package_id: pack.id,
        wx_amount: pack.wx_amount,
        price_rub: pack.price_rub,
        provider: paymentProvider.name,
        status: 'pending',
        metadata: JSON.stringify({ packageSlug }),
      })
      .returning('*');

    try {
      const charge = await paymentProvider.createCharge({
        userId,
        purchaseId: row.id,
        packageSlug,
        packageName: pack.name,
        wxAmount: parseFloat(pack.wx_amount),
        priceRub: parseFloat(pack.price_rub),
        customerEmail: user.email,
      });

      await db('coin_purchases').where('id', row.id).update({
        provider_ref: charge.providerRef,
        status: charge.status === 'failed' ? 'failed' : 'pending',
        metadata: JSON.stringify({
          packageSlug,
          confirmationUrl: charge.confirmationUrl ?? null,
        }),
      });

      if (charge.status === 'failed') {
        throw new AppError(ErrorCode.INTERNAL_ERROR, 'Payment failed', 402);
      }

      if (charge.status === 'succeeded') {
        await this.fulfillPurchase(row.id, charge.providerRef);
        const succeeded = await db('coin_purchases').where('id', row.id).first();
        return this.formatPurchase(succeeded as PurchaseRow, charge.confirmationUrl);
      }

      logger.info('WX purchase pending payment', {
        userId,
        packageSlug,
        purchaseId: row.id,
        provider: paymentProvider.name,
      });

      return {
        purchaseId: row.id,
        wxAmount: parseFloat(pack.wx_amount),
        currency: config.CURRENCY_CODE,
        provider: paymentProvider.name,
        status: 'pending' as const,
        confirmationUrl: charge.confirmationUrl ?? null,
      };
    } catch (err) {
      const current = await db('coin_purchases').where('id', row.id).first();
      if (current?.status !== 'succeeded') {
        await db('coin_purchases').where('id', row.id).update({
          status: 'failed',
          completed_at: new Date(),
        });
      }
      throw err;
    }
  }

  async getPurchase(userId: string, purchaseId: string) {
    const row = await db('coin_purchases').where({ id: purchaseId }).first();
    if (!row) throw new NotFoundError('Purchase', purchaseId);
    if (row.user_id !== userId) throw new ForbiddenError('Purchase does not belong to this user');

    if (row.status === 'pending' && row.provider_ref && paymentProvider.name !== 'mock') {
      await this.syncFromProvider(row as PurchaseRow);
      const fresh = await db('coin_purchases').where('id', purchaseId).first();
      return this.formatPurchase(fresh as PurchaseRow);
    }

    return this.formatPurchase(row as PurchaseRow);
  }

  async handleYooKassaWebhook(body: unknown) {
    if (paymentProvider.name !== 'yookassa') {
      logger.warn('YooKassa webhook ignored: PAYMENT_PROVIDER is not yookassa');
      return { ignored: true as const };
    }

    const payload = YooKassaWebhookDto.parse(body);
    const lookup = await paymentProvider.getPayment(payload.object.id);
    const webhookPurchaseId = payload.object.metadata?.purchaseId;
    const purchaseId =
      lookup.metadata.purchaseId ?? (webhookPurchaseId != null ? String(webhookPurchaseId) : undefined);

    let purchase: PurchaseRow | undefined;
    if (purchaseId) {
      purchase = (await db('coin_purchases').where('id', purchaseId).first()) as PurchaseRow | undefined;
    }
    if (!purchase) {
      purchase = (await db('coin_purchases').where('provider_ref', lookup.providerRef).first()) as
        | PurchaseRow
        | undefined;
    }

    if (!purchase) {
      logger.warn('YooKassa webhook for unknown purchase', {
        providerRef: lookup.providerRef,
        purchaseId,
        event: payload.event,
      });
      return { ignored: true };
    }

    if (lookup.status === 'succeeded' && lookup.paid) {
      try {
        this.assertAmountMatches(purchase, lookup.amountValue);
      } catch (err) {
        logger.error('YooKassa amount mismatch', {
          purchaseId: purchase.id,
          error: (err as Error).message,
        });
        await this.markFailed(purchase.id, lookup.providerRef);
        return { purchaseId: purchase.id, status: 'failed' };
      }
      await this.fulfillPurchase(purchase.id, lookup.providerRef);
      return { purchaseId: purchase.id, status: 'succeeded' };
    }

    if (lookup.status === 'canceled' || lookup.status === 'failed') {
      await this.markFailed(purchase.id, lookup.providerRef);
      return { purchaseId: purchase.id, status: 'failed' };
    }

    return { purchaseId: purchase.id, status: purchase.status };
  }

  private async syncFromProvider(row: PurchaseRow): Promise<void> {
    if (!row.provider_ref) return;
    try {
      const lookup = await paymentProvider.getPayment(row.provider_ref);
      if (lookup.status === 'succeeded' && lookup.paid) {
        try {
          this.assertAmountMatches(row, lookup.amountValue);
        } catch (err) {
          logger.error('Payment amount mismatch on sync', {
            purchaseId: row.id,
            error: (err as Error).message,
          });
          await this.markFailed(row.id, lookup.providerRef);
          return;
        }
        await this.fulfillPurchase(row.id, lookup.providerRef);
        return;
      }
      if (lookup.status === 'canceled' || lookup.status === 'failed') {
        await this.markFailed(row.id, lookup.providerRef);
      }
    } catch (err) {
      logger.warn('Payment status sync failed', {
        purchaseId: row.id,
        error: (err as Error).message,
      });
    }
  }

  private assertAmountMatches(purchase: PurchaseRow, amountValue: string): void {
    const expected = new Decimal(purchase.price_rub).toFixed(2);
    const got = new Decimal(amountValue || 0).toFixed(2);
    if (expected !== got) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Payment amount does not match package price', 400, {
        expected,
        got,
      });
    }
  }

  private async fulfillPurchase(purchaseId: string, providerRef: string): Promise<PurchaseRow> {
    const result = await db.transaction(async (trx) => {
      const row = (await trx('coin_purchases').where('id', purchaseId).forUpdate().first()) as PurchaseRow | undefined;
      if (!row) throw new NotFoundError('Purchase', purchaseId);
      if (row.status === 'succeeded') return { already: true, row };

      const packMeta = this.readMetadata(row.metadata);
      await creditWx(
        trx,
        row.user_id,
        row.wx_amount,
        'purchase',
        `Purchased ${row.wx_amount} ${config.CURRENCY_CODE}`,
        {
          referenceType: 'coin_purchase',
          referenceId: row.id,
          metadata: { packageSlug: packMeta.packageSlug, provider: row.provider },
        }
      );

      const [updated] = await trx('coin_purchases')
        .where('id', row.id)
        .update({
          status: 'succeeded',
          provider_ref: providerRef || row.provider_ref,
          completed_at: new Date(),
        })
        .returning('*');

      return { already: false, row: updated as PurchaseRow };
    });

    if (!result.already) {
      await portfolioCache.del(`portfolio:${result.row.user_id}`);
      logger.info('WX purchased', {
        userId: result.row.user_id,
        purchaseId: result.row.id,
        provider: result.row.provider,
      });
    }

    return result.row;
  }

  private async markFailed(purchaseId: string, providerRef: string): Promise<void> {
    await db.transaction(async (trx: Knex.Transaction) => {
      const row = await trx('coin_purchases').where('id', purchaseId).forUpdate().first();
      if (!row || row.status === 'succeeded') return;
      await trx('coin_purchases').where('id', purchaseId).update({
        status: 'failed',
        provider_ref: providerRef || row.provider_ref,
        completed_at: new Date(),
      });
    });
  }

  /**
   * Start a rewarded-ad session: issues a one-time nonce with a short TTL.
   * The client must show the ad (real network or mock timer) and then
   * claim the reward with this sessionId.
   */
  async startAdSession(userId: string) {
    const availability = await this.getAdAvailability(userId);
    if (!availability.canWatch) {
      throw new AppError(ErrorCode.RATE_LIMITED, availability.reason ?? 'Ad reward is not available yet', 429, {
        nextAt: availability.nextAt,
      });
    }

    const sessionId = randomUUID();
    const session: AdSession = { userId, createdAt: Date.now() };
    await redisClient.setex(adSessionKey(sessionId), AD_SESSION_TTL_SECONDS, JSON.stringify(session));

    return {
      sessionId,
      provider: config.AD_PROVIDER,
      blockId: config.AD_PROVIDER === 'yandex' ? config.YANDEX_RTB_BLOCK_ID ?? null : null,
      rewardAmount: config.AD_REWARD_AMOUNT,
      minWatchSeconds: config.AD_MIN_WATCH_SECONDS,
      expiresInSeconds: AD_SESSION_TTL_SECONDS,
    };
  }

  async claimAdReward(userId: string, input: z.infer<typeof AdRewardClaimDto>) {
    const { sessionId } = AdRewardClaimDto.parse(input);
    const key = adSessionKey(sessionId);

    const peek = await redisClient.get(key);
    if (!peek) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Ad session is invalid or expired', 400);
    }

    let session: AdSession;
    try {
      session = JSON.parse(peek) as AdSession;
    } catch {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Ad session is corrupted', 400);
    }

    if (session.userId !== userId) {
      throw new ForbiddenError('Ad session does not belong to this user');
    }

    const elapsedSeconds = (Date.now() - session.createdAt) / 1000;
    if (elapsedSeconds < config.AD_MIN_WATCH_SECONDS) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Ad was not watched long enough', 400, {
        minWatchSeconds: config.AD_MIN_WATCH_SECONDS,
      });
    }

    // Consume the nonce only after the watch-time check so a premature
    // claim does not burn a still-valid session.
    const raw = await redisClient.getdel(key);
    if (!raw) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Ad session is invalid or expired', 400);
    }

    const amount = new Decimal(config.AD_REWARD_AMOUNT);

    const result = await db.transaction(async (trx) => {
      // Serialize concurrent claims per user, then re-check limits inside the lock.
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`ad_reward:${userId}`]);

      const availability = await this.getAdAvailability(userId, trx);
      if (!availability.canWatch) {
        throw new AppError(ErrorCode.RATE_LIMITED, availability.reason ?? 'Ad reward is not available yet', 429, {
          nextAt: availability.nextAt,
        });
      }

      const [reward] = await trx('ad_rewards')
        .insert({
          user_id: userId,
          wx_amount: amount.toFixed(8),
          provider: config.AD_PROVIDER,
        })
        .returning('*');

      const credited = await creditWx(
        trx,
        userId,
        amount,
        'ad_reward',
        `Watched ad reward ${amount.toFixed(0)} ${config.CURRENCY_CODE}`,
        { referenceType: 'ad_reward', referenceId: reward.id, metadata: { sessionId } }
      );

      return { reward, credited };
    });

    await portfolioCache.del(`portfolio:${userId}`);
    logger.info('Ad reward granted', { userId, amount: amount.toNumber(), provider: config.AD_PROVIDER });

    return {
      wxAmount: amount.toNumber(),
      currency: config.CURRENCY_CODE,
      available: result.credited.balanceAfter.toNumber(),
      nextAt: new Date(Date.now() + config.AD_REWARD_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString(),
    };
  }

  private async getAdAvailability(userId: string, trx: Knex = db) {
    const cooldownMs = config.AD_REWARD_COOLDOWN_HOURS * 60 * 60 * 1000;
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [last, todayCountRow] = await Promise.all([
      trx('ad_rewards').where('user_id', userId).orderBy('created_at', 'desc').first(),
      trx('ad_rewards').where('user_id', userId).where('created_at', '>=', startOfDay).count('* as count').first(),
    ]);

    const adsToday = parseInt(String((todayCountRow as { count?: string })?.count ?? 0), 10);
    const lastAt = last?.created_at ? new Date(last.created_at) : null;
    const nextByCooldown = lastAt ? new Date(lastAt.getTime() + cooldownMs) : new Date(0);
    const now = new Date();

    if (adsToday >= config.AD_REWARD_MAX_PER_DAY) {
      const tomorrow = new Date(startOfDay);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      return {
        canWatch: false,
        adsToday,
        maxPerDay: config.AD_REWARD_MAX_PER_DAY,
        rewardAmount: config.AD_REWARD_AMOUNT,
        nextAt: tomorrow.toISOString(),
        reason: 'Daily ad reward limit reached',
        reasonCode: 'daily_limit' as const,
      };
    }

    if (nextByCooldown > now) {
      return {
        canWatch: false,
        adsToday,
        maxPerDay: config.AD_REWARD_MAX_PER_DAY,
        rewardAmount: config.AD_REWARD_AMOUNT,
        nextAt: nextByCooldown.toISOString(),
        reason: 'Ad reward cooldown active',
        reasonCode: 'cooldown' as const,
      };
    }

    return {
      canWatch: true,
      adsToday,
      maxPerDay: config.AD_REWARD_MAX_PER_DAY,
      rewardAmount: config.AD_REWARD_AMOUNT,
      nextAt: null as string | null,
      reason: null as string | null,
      reasonCode: null as 'daily_limit' | 'cooldown' | null,
    };
  }

  private utcToday(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private utcYesterday(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  async getDailyBonusAvailability(userId: string) {
    const today = this.utcToday();
    const claimed = await db('daily_bonus_claims').where({ user_id: userId, claimed_on: today }).first();
    const yesterday = await db('daily_bonus_claims').where({ user_id: userId, claimed_on: this.utcYesterday() }).first();
    return {
      canClaim: !claimed,
      amount: config.DAILY_BONUS_AMOUNT,
      streak: claimed ? claimed.streak : yesterday ? yesterday.streak : 0,
      claimedOn: claimed ? today : null,
    };
  }

  async claimDailyBonus(userId: string) {
    const today = this.utcToday();
    const amount = new Decimal(config.DAILY_BONUS_AMOUNT);

    const result = await db.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`daily_bonus:${userId}`]);
      const existing = await trx('daily_bonus_claims').where({ user_id: userId, claimed_on: today }).first();
      if (existing) {
        throw new AppError(ErrorCode.RATE_LIMITED, 'Daily bonus already claimed', 429);
      }

      const yesterday = await trx('daily_bonus_claims')
        .where({ user_id: userId, claimed_on: this.utcYesterday() })
        .first();
      const streak = (yesterday?.streak ?? 0) + 1;

      const [claim] = await trx('daily_bonus_claims')
        .insert({
          user_id: userId,
          claimed_on: today,
          streak,
          wx_amount: amount.toFixed(8),
        })
        .returning('*');

      const credited = await creditWx(
        trx,
        userId,
        amount,
        'daily_bonus',
        `Daily bonus day ${streak}`,
        { referenceType: 'daily_bonus', referenceId: claim.id }
      );
      return { credited, streak };
    });

    await portfolioCache.del(`portfolio:${userId}`);
    return {
      wxAmount: amount.toNumber(),
      currency: config.CURRENCY_CODE,
      available: result.credited.balanceAfter.toNumber(),
      streak: result.streak,
    };
  }

  private formatPackage(p: {
    id: string;
    slug: string;
    name: string;
    wx_amount: string;
    price_rub: string;
  }) {
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      wxAmount: parseFloat(p.wx_amount),
      priceRub: parseFloat(p.price_rub),
      currency: config.CURRENCY_CODE,
    };
  }

  private formatPurchase(row: PurchaseRow, confirmationUrl?: string | null) {
    const meta = this.readMetadata(row.metadata);
    return {
      purchaseId: row.id,
      wxAmount: parseFloat(row.wx_amount),
      currency: config.CURRENCY_CODE,
      provider: row.provider,
      status: row.status,
      confirmationUrl: confirmationUrl ?? (typeof meta.confirmationUrl === 'string' ? meta.confirmationUrl : null),
    };
  }

  private readMetadata(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    }
    if (typeof value === 'object') return value as Record<string, unknown>;
    return {};
  }
}
