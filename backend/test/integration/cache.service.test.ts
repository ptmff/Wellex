/**
 * CacheService (src/infrastructure/redis/cache.service.ts) against a real Redis.
 */
import { CacheService, redisClient } from '../../src/infrastructure/redis/cache.service';

describe('CacheService on Redis', () => {
  const cache = new CacheService('t');

  it('set/get/del with namespace prefix and TTL', async () => {
    await cache.set('k', { a: 1 }, 5);
    expect(await cache.get('k')).toEqual({ a: 1 });
    expect(await redisClient.ttl('pm:t:k')).toBeGreaterThan(0);
    await cache.del('k');
    expect(await cache.get('k')).toBeNull();
  });

  it('getOrSet calls the fetcher only on a cache miss', async () => {
    const fetcher = jest.fn().mockResolvedValue(42);
    expect(await cache.getOrSet('x', fetcher, 10)).toBe(42);
    expect(await cache.getOrSet('x', fetcher, 10)).toBe(42);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('delPattern removes all matching keys', async () => {
    await cache.set('list:1', 1);
    await cache.set('list:2', 2);
    await cache.set('other', 3);
    await cache.delPattern('list:*');
    expect(await redisClient.keys('pm:t:*')).toEqual(['pm:t:other']);
  });

  it('distributed lock: second acquire fails until the owner releases it; a foreign token cannot release', async () => {
    const token = await cache.acquireLock('res', 2000);
    expect(token).toBeTruthy();
    expect(await cache.acquireLock('res', 2000)).toBeNull();
    await cache.releaseLock('res', 'not-the-owner');
    expect(await cache.acquireLock('res', 2000)).toBeNull();
    await cache.releaseLock('res', token!);
    expect(await cache.acquireLock('res', 2000)).toBeTruthy();
  });

  it('sliding-window rate limit allows `limit` hits and blocks the next one', async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await cache.checkRateLimit('user-1', 3, 60)).allowed);
    expect(results).toEqual([true, true, true, false]);
  });

  it('sorted-set helpers keep members ordered by score', async () => {
    await cache.zAdd('board', 10, 'b');
    await cache.zAdd('board', 5, 'a');
    expect(await cache.zRange('board', 0, -1)).toEqual(['a', 'b']);
  });
});
