import { z } from 'zod';
import Decimal from 'decimal.js';
import { db } from '../../database/connection';
import { config } from '../../config';
import { AppError, ErrorCode, NotFoundError } from '../../common/errors';
import { logger } from '../../common/logger';
import { creditWx } from './wallet';
import { paymentProvider } from './payment.provider';
import { portfolioCache } from '../../infrastructure/redis/cache.service';

export const PurchaseDto = z.object({
  packageSlug: z.string().min(1).max(50),
});

const DEFAULT_PACKAGES = [
  { slug: 'starter', name: 'Starter', wx_amount: '500', price_rub: '49.00', sort_order: 1 },
  { slug: 'pack', name: 'Pack', wx_amount: '2000', price_rub: '149.00', sort_order: 2 },
  { slug: 'whale', name: 'Whale', wx_amount: '5000', price_rub: '299.00', sort_order: 3 },
];

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
      ad,
    };
  }

  async purchase(userId: string, input: z.infer<typeof PurchaseDto>) {
    const { packageSlug } = PurchaseDto.parse(input);
    await this.ensurePackages();

    const pack = await db('coin_packages').where({ slug: packageSlug, is_active: true }).first();
    if (!pack) throw new NotFoundError('Package', packageSlug);

    const purchase = await db.transaction(async (trx) => {
      const [row] = await trx('coin_purchases')
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

      const charge = await paymentProvider.createCharge({
        userId,
        purchaseId: row.id,
        packageSlug,
        wxAmount: parseFloat(pack.wx_amount),
        priceRub: parseFloat(pack.price_rub),
      });

      if (charge.status !== 'succeeded') {
        await trx('coin_purchases').where('id', row.id).update({
          status: charge.status === 'failed' ? 'failed' : 'pending',
          provider_ref: charge.providerRef,
        });
        throw new AppError(
          ErrorCode.INTERNAL_ERROR,
          'Payment is pending or failed; retry later or wait for webhook',
          402
        );
      }

      await creditWx(trx, userId, pack.wx_amount, 'purchase', `Purchased ${pack.wx_amount} ${config.CURRENCY_CODE}`, {
        referenceType: 'coin_purchase',
        referenceId: row.id,
        metadata: { packageSlug, provider: charge.provider },
      });

      const [updated] = await trx('coin_purchases')
        .where('id', row.id)
        .update({
          status: 'succeeded',
          provider_ref: charge.providerRef,
          completed_at: new Date(),
        })
        .returning('*');

      return updated;
    });

    await portfolioCache.del(`portfolio:${userId}`);
    logger.info('WX purchased', { userId, packageSlug, purchaseId: purchase.id });

    return {
      purchaseId: purchase.id,
      wxAmount: parseFloat(purchase.wx_amount),
      currency: config.CURRENCY_CODE,
      provider: purchase.provider,
      status: purchase.status,
    };
  }

  async claimAdReward(userId: string) {
    const availability = await this.getAdAvailability(userId);
    if (!availability.canWatch) {
      throw new AppError(ErrorCode.RATE_LIMITED, availability.reason ?? 'Ad reward is not available yet', 429, {
        nextAt: availability.nextAt,
      });
    }

    const amount = new Decimal(config.AD_REWARD_AMOUNT);

    const result = await db.transaction(async (trx) => {
      const [reward] = await trx('ad_rewards')
        .insert({
          user_id: userId,
          wx_amount: amount.toFixed(8),
          provider: 'mock',
        })
        .returning('*');

      const credited = await creditWx(
        trx,
        userId,
        amount,
        'ad_reward',
        `Watched ad reward ${amount.toFixed(0)} ${config.CURRENCY_CODE}`,
        { referenceType: 'ad_reward', referenceId: reward.id }
      );

      return { reward, credited };
    });

    await portfolioCache.del(`portfolio:${userId}`);
    logger.info('Ad reward granted', { userId, amount: amount.toNumber() });

    return {
      wxAmount: amount.toNumber(),
      currency: config.CURRENCY_CODE,
      available: result.credited.balanceAfter.toNumber(),
      nextAt: new Date(Date.now() + config.AD_REWARD_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString(),
    };
  }

  private async getAdAvailability(userId: string) {
    const cooldownMs = config.AD_REWARD_COOLDOWN_HOURS * 60 * 60 * 1000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [last, todayCountRow] = await Promise.all([
      db('ad_rewards').where('user_id', userId).orderBy('created_at', 'desc').first(),
      db('ad_rewards').where('user_id', userId).where('created_at', '>=', startOfDay).count('* as count').first(),
    ]);

    const adsToday = parseInt(String((todayCountRow as { count?: string })?.count ?? 0), 10);
    const lastAt = last?.created_at ? new Date(last.created_at) : null;
    const nextByCooldown = lastAt ? new Date(lastAt.getTime() + cooldownMs) : new Date(0);
    const now = new Date();

    if (adsToday >= config.AD_REWARD_MAX_PER_DAY) {
      const tomorrow = new Date(startOfDay);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return {
        canWatch: false,
        adsToday,
        maxPerDay: config.AD_REWARD_MAX_PER_DAY,
        rewardAmount: config.AD_REWARD_AMOUNT,
        nextAt: tomorrow.toISOString(),
        reason: 'Daily ad reward limit reached',
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
      };
    }

    return {
      canWatch: true,
      adsToday,
      maxPerDay: config.AD_REWARD_MAX_PER_DAY,
      rewardAmount: config.AD_REWARD_AMOUNT,
      nextAt: null as string | null,
      reason: null as string | null,
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
}
