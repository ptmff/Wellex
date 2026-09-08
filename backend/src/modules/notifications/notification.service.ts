import { db } from '../../database/connection';
import { logger } from '../../common/logger';
import type { WebSocketService } from '../../infrastructure/websocket/ws.service';

export type NotificationType = 'order_filled' | 'market_resolved' | 'comment' | 'system';

export class NotificationService {
  constructor(private readonly wsService?: WebSocketService) {}

  async notifyFill(input: {
    marketId: string;
    tradeId: string;
    buyerId: string;
    sellerId: string;
    side: string;
    price: number;
    quantity: number;
  }): Promise<void> {
    const market = await db('markets').select('title').where('id', input.marketId).first();
    const title = market?.title ?? 'Market';
    const body = `${input.side.toUpperCase()} × ${input.quantity.toFixed(2)} @ ${(input.price * 100).toFixed(1)}¢`;
    await Promise.all([
      this.create(input.buyerId, 'order_filled', 'Order filled', body, input),
      input.sellerId !== input.buyerId
        ? this.create(input.sellerId, 'order_filled', 'Order filled', body, input)
        : Promise.resolve(),
    ]);
    void title;
  }

  async notifyResolved(input: { marketId: string; outcome: string; userIds: string[] }): Promise<void> {
    const market = await db('markets').select('title').where('id', input.marketId).first();
    const title = market?.title ?? 'Market';
    await Promise.all(
      [...new Set(input.userIds)].map((userId) =>
        this.create(userId, 'market_resolved', 'Market resolved', `${title} → ${input.outcome.toUpperCase()}`, input)
      )
    );
  }

  async create(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    payload: Record<string, unknown> = {}
  ) {
    try {
      const [row] = await db('notifications')
        .insert({
          user_id: userId,
          type,
          title,
          body,
          payload: JSON.stringify(payload),
        })
        .returning('*');
      this.wsService?.sendToUser(userId, 'notification', this.format(row));
      return this.format(row);
    } catch (err) {
      logger.warn('Failed to create notification', { userId, type, error: (err as Error).message });
      return null;
    }
  }

  async list(userId: string, limit = 30) {
    const rows = await db('notifications')
      .where('user_id', userId)
      .orderBy('created_at', 'desc')
      .limit(Math.min(limit, 100));
    const unreadRow = await db('notifications')
      .where({ user_id: userId })
      .whereNull('read_at')
      .count('* as count')
      .first();
    return {
      unread: parseInt(String((unreadRow as { count?: string })?.count ?? 0), 10),
      items: rows.map((r) => this.format(r)),
    };
  }

  async markRead(userId: string, id: string) {
    await db('notifications').where({ id, user_id: userId }).update({ read_at: new Date() });
    return this.list(userId);
  }

  async markAllRead(userId: string) {
    await db('notifications').where({ user_id: userId }).whereNull('read_at').update({ read_at: new Date() });
    return this.list(userId);
  }

  private format(row: {
    id: string;
    type: string;
    title: string;
    body: string;
    payload: unknown;
    read_at: Date | null;
    created_at: Date;
  }) {
    let payload: unknown = row.payload;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      payload,
      read: Boolean(row.read_at),
      createdAt: row.created_at,
    };
  }
}
