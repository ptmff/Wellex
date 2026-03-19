import { db } from '../../database/connection';
import { logger } from '../../common/logger';

export interface ActivityRecord {
  userId?: string;
  marketId?: string;
  type: 'trade' | 'market_created' | 'market_resolved' | 'market_cancelled' |
        'order_placed' | 'order_cancelled' | 'position_opened' | 'position_closed';
  data: Record<string, unknown>;
  isPublic?: boolean;
}

export class ActivityService {
  async record(activity: ActivityRecord): Promise<void> {
    try {
      await db('activity_feed').insert({
        user_id: activity.userId ?? null,
        market_id: activity.marketId ?? null,
        type: activity.type,
        data: JSON.stringify(activity.data),
        is_public: activity.isPublic ?? true,
        created_at: new Date(),
      });
    } catch (err) {
      // Activity feed failures should NOT break the main flow
      logger.warn('Failed to record activity', {
        type: activity.type,
        error: (err as Error).message,
      });
    }
  }

  async getMarketFeed(
    marketId: string,
    limit = 50,
    before?: Date
  ) {
    const q = db('activity_feed as a')
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .where('a.market_id', marketId)
      .where('a.is_public', true)
      .orderBy('a.created_at', 'desc')
      .limit(limit)
      .select('a.*', 'u.username', 'u.display_name');

    if (before) q.where('a.created_at', '<', before);

    const rows = await q;
    return rows.map(this.formatActivity);
  }

  async getGlobalFeed(limit = 50, before?: Date) {
    const q = db('activity_feed as a')
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .leftJoin('markets as m', 'a.market_id', 'm.id')
      .where('a.is_public', true)
      .whereIn('a.type', ['trade', 'market_created', 'market_resolved'])
      .orderBy('a.created_at', 'desc')
      .limit(limit)
      .select('a.*', 'u.username', 'm.title as market_title');

    if (before) q.where('a.created_at', '<', before);

    const rows = await q;
    return rows.map(this.formatActivity);
  }

  async getUserFeed(userId: string, limit = 50) {
    const rows = await db('activity_feed as a')
      .leftJoin('markets as m', 'a.market_id', 'm.id')
      .where('a.user_id', userId)
      .orderBy('a.created_at', 'desc')
      .limit(limit)
      .select('a.*', 'm.title as market_title');

    return rows.map(this.formatActivity);
  }

  private formatActivity(row: any) {
    return {
      id: row.id,
      type: row.type,
      userId: row.user_id,
      username: row.username,
      marketId: row.market_id,
      marketTitle: row.market_title,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      createdAt: row.created_at,
    };
  }
}
