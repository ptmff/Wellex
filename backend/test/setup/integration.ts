/**
 * Per-test-file hooks for integration/API suites: clean DB + Redis before each
 * test and close connections after the file.
 */
import { db } from '../../src/database/connection';
import { redisClient } from '../../src/infrastructure/redis/cache.service';
import { resetState } from '../helpers/db';

beforeEach(async () => {
  await resetState();
});

afterAll(async () => {
  // let fire-and-forget side effects (setImmediate broadcasts, notifications) settle
  await new Promise((r) => setTimeout(r, 150));
  await db.destroy();
  redisClient.disconnect();
});
