/**
 * Test environment. Values are applied only when not already provided, so CI
 * (or a developer) can point the suite at another Postgres/Redis.
 * All secrets below are throw-away test values, NOT production secrets.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_PORT: '5433',
  DB_NAME: 'prediction_market_test',
  DB_USER: 'postgres',
  DB_PASSWORD: 'secret',
  DB_POOL_MIN: '0',
  DB_POOL_MAX: '10',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_DB: '15',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789-abcdefghij',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789-abcdefghi',
  ADMIN_SECRET_KEY: 'test-admin-key',
  INITIAL_USER_BALANCE: '1000',
  PAYMENT_PROVIDER: 'mock',
  AD_PROVIDER: 'mock',
  LOG_LEVEL: 'error',
  LOG_DIR: '/tmp/wellex-test-logs',
};

process.env.NODE_ENV = 'test';
for (const [k, v] of Object.entries(defaults)) {
  if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
}

// Safety net: never run destructive test helpers against a non-test database.
if (!/test/i.test(process.env.DB_NAME ?? '')) {
  throw new Error(`Refusing to run tests against database "${process.env.DB_NAME}" (name must contain "test")`);
}
