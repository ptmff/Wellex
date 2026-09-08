import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_VERSION: z.string().default('v1'),

  // Database
  DB_HOST: z.string(),
  DB_PORT: z.coerce.number().default(5433),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_POOL_MIN: z.coerce.number().default(2),
  DB_POOL_MAX: z.coerce.number().default(20),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().default(0),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // Trading / in-game currency
  MIN_TRADE_AMOUNT: z.coerce.number().default(1),
  MAX_TRADE_AMOUNT: z.coerce.number().default(100000),
  INITIAL_USER_BALANCE: z.coerce.number().default(1000),
  CURRENCY_CODE: z.string().default('WX'),
  SEED_ON_START: z.enum(['true', 'false']).default('false').transform((v: string) => v === 'true'),
  INGEST_ON_START: z.enum(['true', 'false']).default('false').transform((v: string) => v === 'true'),

  // Economy (ads + mock shop; real PSP/ads later)
  AD_REWARD_AMOUNT: z.coerce.number().default(100),
  AD_REWARD_COOLDOWN_HOURS: z.coerce.number().default(4),
  AD_REWARD_MAX_PER_DAY: z.coerce.number().default(4),
  BOT_USER_BALANCE: z.coerce.number().default(1_000_000),

  // Polymarket ingest (Gamma API, read-only)
  POLYMARKET_GAMMA_URL: z.string().url().default('https://gamma-api.polymarket.com'),
  POLYMARKET_INGEST_LIMIT: z.coerce.number().int().min(1).max(100).default(40),

  // Cache TTLs
  CACHE_MARKET_TTL: z.coerce.number().default(30),
  CACHE_PRICE_TTL: z.coerce.number().default(5),
  CACHE_PORTFOLIO_TTL: z.coerce.number().default(10),

  // WebSocket
  WS_HEARTBEAT_INTERVAL: z.coerce.number().default(30000),

  // Admin
  ADMIN_SECRET_KEY: z.string(),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_DIR: z.string().default('./logs'),
});

const parseResult = configSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parseResult.error.format());
  process.exit(1);
}

export const config = parseResult.data;
export type Config = typeof config;
