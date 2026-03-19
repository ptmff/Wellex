import Knex from 'knex';
import { config } from '../config';
import { logger } from '../common/logger';

export const db = Knex({
  client: 'pg',
  connection: {
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  },
  pool: {
    min: config.DB_POOL_MIN,
    max: config.DB_POOL_MAX,
    acquireTimeoutMillis: 30000,
    createTimeoutMillis: 30000,
    destroyTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 200,
  },
  acquireConnectionTimeout: 60000,
});

export async function checkDatabaseConnection(): Promise<void> {
  try {
    await db.raw('SELECT 1');
    logger.info('✅ Database connection established');
  } catch (error) {
    logger.error('❌ Database connection failed', { error });
    throw error;
  }
}

// Transaction helper with automatic rollback
export async function withTransaction<T>(
  callback: (trx: Knex.Knex.Transaction) => Promise<T>
): Promise<T> {
  return db.transaction(callback);
}

// Paginated query helper
export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function paginate<T>(
  query: Knex.Knex.QueryBuilder,
  { page, limit }: PaginationParams
): Promise<PaginatedResult<T>> {
  const offset = (page - 1) * limit;

  const [countResult, data] = await Promise.all([
    query.clone().clearSelect().clearOrder().count('* as count').first(),
    query.limit(limit).offset(offset),
  ]);

  const total = parseInt(String((countResult as any)?.count ?? 0), 10);

  return {
    data: data as T[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
