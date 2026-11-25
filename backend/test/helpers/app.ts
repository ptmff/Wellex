import type { AddressInfo } from 'net';
import request from 'supertest';
import { createApp, AppContext } from '../../src/app';
import { redisClient } from '../../src/infrastructure/redis/cache.service';

/**
 * Builds the real Express app (src/app.ts) for supertest. WebSocketService opens a duplicated
 * Redis connection for pub/sub and never closes it on shutdown (see BUG-11 in docs/test-report),
 * so the helper captures it to close it after the suite.
 */
export function createTestApp() {
  const duplicates: Array<{ disconnect: () => void }> = [];
  const original = redisClient.duplicate.bind(redisClient);
  const spy = jest.spyOn(redisClient, 'duplicate').mockImplementation((...args: any[]) => {
    const d = original(...args);
    duplicates.push(d);
    return d;
  });
  const ctx: AppContext = createApp();
  spy.mockRestore();

  const api = () => request(ctx.app);
  const close = async () => {
    ctx.wsService.shutdown();
    await new Promise<void>((r) => (ctx.httpServer.listening ? ctx.httpServer.close(() => r()) : r()));
    duplicates.forEach((d) => d.disconnect());
  };
  const listen = async (): Promise<number> => {
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    return (ctx.httpServer.address() as AddressInfo).port;
  };
  return { ctx, api, close, listen };
}

export const API = '/api/v1';
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
