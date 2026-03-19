import Redis from 'ioredis';
import { config } from '../../config';
import { logger } from '../../common/logger';

export const redisClient = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
  db: config.REDIS_DB,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) return true;
    return false;
  },
  lazyConnect: false,
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
});

redisClient.on('connect', () => logger.info('✅ Redis connected'));
redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));
redisClient.on('reconnecting', () => logger.warn('Redis reconnecting...'));

// ─────────────────────────────────────────────────────────────────
// CACHE SERVICE
// ─────────────────────────────────────────────────────────────────

export class CacheService {
  private prefix: string;

  constructor(namespace: string) {
    this.prefix = `pm:${namespace}:`;
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await redisClient.get(this.key(key));
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (err) {
      logger.warn('Cache get error', { key, error: (err as Error).message });
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await redisClient.setex(this.key(key), ttlSeconds, serialized);
      } else {
        await redisClient.set(this.key(key), serialized);
      }
    } catch (err) {
      logger.warn('Cache set error', { key, error: (err as Error).message });
    }
  }

  async del(key: string): Promise<void> {
    try {
      await redisClient.del(this.key(key));
    } catch (err) {
      logger.warn('Cache del error', { key, error: (err as Error).message });
    }
  }

  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await redisClient.keys(`${this.prefix}${pattern}`);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch (err) {
      logger.warn('Cache delPattern error', { pattern, error: (err as Error).message });
    }
  }

  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const fresh = await fetcher();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  // Distributed lock using SET NX
  async acquireLock(
    resource: string,
    ttlMs: number = 5000
  ): Promise<string | null> {
    const lockKey = `lock:${resource}`;
    const lockValue = `${Date.now()}-${Math.random()}`;
    const acquired = await redisClient.set(
      lockKey,
      lockValue,
      'PX',
      ttlMs,
      'NX'
    );
    return acquired ? lockValue : null;
  }

  async releaseLock(resource: string, lockValue: string): Promise<void> {
    const lockKey = `lock:${resource}`;
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redisClient.eval(script, 1, lockKey, lockValue);
  }

  // Leaderboard / sorted set helpers
  async zAdd(key: string, score: number, member: string): Promise<void> {
    await redisClient.zadd(this.key(key), score, member);
  }

  async zRange(key: string, start: number, stop: number, withScores = false): Promise<string[]> {
    if (withScores) {
      return redisClient.zrangebyscore(this.key(key), start, stop, 'WITHSCORES');
    }
    return redisClient.zrange(this.key(key), start, stop);
  }

  // Pub/Sub for real-time
  async publish(channel: string, message: unknown): Promise<void> {
    try {
      await redisClient.publish(channel, JSON.stringify(message));
    } catch (err) {
      logger.warn('Redis publish error', { channel, error: (err as Error).message });
    }
  }

  // Rate limiting with sliding window
  async checkRateLimit(
    identifier: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const key = `rate:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    const pipeline = redisClient.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, `${now}-${Math.random()}`);
    pipeline.zcard(key);
    pipeline.expire(key, windowSeconds);

    const results = await pipeline.exec();
    const count = results?.[2]?.[1] as number ?? 0;

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: now + windowSeconds * 1000,
    };
  }
}

export const marketCache = new CacheService('markets');
export const priceCache = new CacheService('prices');
export const portfolioCache = new CacheService('portfolio');
export const userCache = new CacheService('users');
export const analyticsCache = new CacheService('analytics');
