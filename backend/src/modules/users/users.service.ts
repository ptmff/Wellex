import { z } from 'zod';
import { db, paginate } from '../../database/connection';
import { userCache } from '../../infrastructure/redis/cache.service';
import { NotFoundError, ConflictError } from '../../common/errors';

export const UpdateProfileDto = z.object({
  displayName: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
  preferences: z
    .object({
      theme: z.enum(['light', 'dark', 'system']).optional(),
      currency: z.enum(['USD', 'EUR', 'RUB']).optional(),
      notifications: z
        .object({
          trades: z.boolean().optional(),
          marketResolution: z.boolean().optional(),
          orderFill: z.boolean().optional(),
        })
        .optional(),
      defaultSlippage: z.number().min(0.1).max(10).optional(),
    })
    .optional(),
});

export const ChangeUsernameDto = z.object({
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores and hyphens'),
});

export class UsersService {
  async getProfile(username: string) {
    const cacheKey = `profile:${username}`;
    const cached = await userCache.get(cacheKey);
    if (cached) return cached;

    const user = await db('users as u')
      .where('u.username', username)
      .where('u.status', 'active')
      .select(
        'u.id', 'u.username', 'u.display_name', 'u.bio',
        'u.avatar_url', 'u.role', 'u.created_at'
      )
      .first();

    if (!user) throw new NotFoundError('User');

    const [tradeStats, marketStats, recentActivity] = await Promise.all([
      db('trades')
        .where('buyer_id', user.id)
        .select(
          db.raw('COUNT(*) as total_trades'),
          db.raw('SUM(total_value) as total_volume'),
          db.raw('COUNT(DISTINCT market_id) as markets_traded')
        )
        .first(),
      db('markets')
        .where('creator_id', user.id)
        .select(
          db.raw('COUNT(*) as markets_created'),
          db.raw("SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_markets")
        )
        .first(),
      db('activity_feed')
        .where('user_id', user.id)
        .where('is_public', true)
        .orderBy('created_at', 'desc')
        .limit(5)
        .select('type', 'data', 'created_at'),
    ]);

    const profile = {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      bio: user.bio,
      avatarUrl: user.avatar_url,
      role: user.role,
      createdAt: user.created_at,
      stats: {
        totalTrades: parseInt(String((tradeStats as any)?.total_trades ?? 0), 10),
        totalVolume: parseFloat(String((tradeStats as any)?.total_volume ?? 0)),
        marketsTraded: parseInt(String((tradeStats as any)?.markets_traded ?? 0), 10),
        marketsCreated: parseInt(String((marketStats as any)?.markets_created ?? 0), 10),
        activeMarkets: parseInt(String((marketStats as any)?.active_markets ?? 0), 10),
      },
      recentActivity: recentActivity.map((a: any) => ({
        type: a.type,
        data: typeof a.data === 'string' ? JSON.parse(a.data) : a.data,
        createdAt: a.created_at,
      })),
    };

    await userCache.set(cacheKey, profile, 120);
    return profile;
  }

  async updateProfile(userId: string, input: z.infer<typeof UpdateProfileDto>) {
    const validated = UpdateProfileDto.parse(input);
    const updates: Record<string, any> = { updated_at: new Date() };

    if (validated.displayName !== undefined) updates.display_name = validated.displayName;
    if (validated.bio !== undefined) updates.bio = validated.bio;
    if (validated.avatarUrl !== undefined) updates.avatar_url = validated.avatarUrl;
    if (validated.preferences !== undefined) {
      const current = await db('users').where('id', userId).select('preferences').first();
      const currentPrefs = typeof current?.preferences === 'string'
        ? JSON.parse(current.preferences)
        : (current?.preferences ?? {});
      updates.preferences = JSON.stringify({ ...currentPrefs, ...validated.preferences });
    }

    const [updated] = await db('users')
      .where('id', userId)
      .update(updates)
      .returning(['id', 'username', 'email', 'display_name', 'bio', 'avatar_url', 'preferences', 'role']);

    await userCache.del(`user:${userId}`);
    await userCache.del(`profile:${updated.username}`);

    return {
      id: updated.id,
      username: updated.username,
      email: updated.email,
      displayName: updated.display_name,
      bio: updated.bio,
      avatarUrl: updated.avatar_url,
      role: updated.role,
      preferences: typeof updated.preferences === 'string'
        ? JSON.parse(updated.preferences)
        : (updated.preferences ?? {}),
    };
  }

  async changeUsername(userId: string, input: z.infer<typeof ChangeUsernameDto>) {
    const { username } = ChangeUsernameDto.parse(input);

    const existing = await db('users').where('username', username).first();
    if (existing) throw new ConflictError('Username already taken');

    const [updated] = await db('users')
      .where('id', userId)
      .update({ username, updated_at: new Date() })
      .returning(['id', 'username']);

    await userCache.del(`user:${userId}`);
    return updated;
  }

  async searchUsers(query: string, limit = 10) {
    if (!query || query.length < 2) return [];

    return db('users')
      .where('status', 'active')
      .where((b) =>
        b
          .whereLike('username', `${query}%`)
          .orWhereLike('display_name', `%${query}%`)
      )
      .limit(limit)
      .select('id', 'username', 'display_name', 'avatar_url', 'role');
  }

  async getLeaderboard(
    type: 'volume' | 'pnl' | 'trades',
    limit = 20
  ) {
    if (type === 'volume') {
      return db('trades as t')
        .join('users as u', 't.buyer_id', 'u.id')
        .where('u.status', 'active')
        .groupBy('u.id', 'u.username', 'u.display_name', 'u.avatar_url')
        .orderBy('total_volume', 'desc')
        .limit(limit)
        .select(
          'u.id', 'u.username', 'u.display_name', 'u.avatar_url',
          db.raw('SUM(t.total_value) as total_volume'),
          db.raw('COUNT(t.id) as trade_count')
        );
    }

    if (type === 'trades') {
      return db('trades as t')
        .join('users as u', 't.buyer_id', 'u.id')
        .where('u.status', 'active')
        .groupBy('u.id', 'u.username', 'u.display_name', 'u.avatar_url')
        .orderBy('trade_count', 'desc')
        .limit(limit)
        .select(
          'u.id', 'u.username', 'u.display_name', 'u.avatar_url',
          db.raw('COUNT(t.id) as trade_count'),
          db.raw('SUM(t.total_value) as total_volume')
        );
    }

    // PnL leaderboard from positions
    return db('positions as p')
      .join('users as u', 'p.user_id', 'u.id')
      .where('u.status', 'active')
      .groupBy('u.id', 'u.username', 'u.display_name', 'u.avatar_url')
      .orderBy('total_pnl', 'desc')
      .limit(limit)
      .select(
        'u.id', 'u.username', 'u.display_name', 'u.avatar_url',
        db.raw('SUM(p.realized_pnl) as total_pnl')
      );
  }
}
