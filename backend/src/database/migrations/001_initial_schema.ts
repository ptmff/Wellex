import { db } from '../connection';
import { logger } from '../../common/logger';
import type { Knex } from 'knex';

export async function runMigrations(): Promise<void> {
  logger.info('Running database migrations...');
  const createTableIfMissing = async (
    tableName: string,
    builder: (t: Knex.TableBuilder) => void
  ): Promise<void> => {
    const exists = await db.schema.hasTable(tableName);
    if (!exists) {
      await db.schema.createTable(tableName, builder);
    }
  };

  await db.schema.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await db.schema.raw('CREATE EXTENSION IF NOT EXISTS "btree_gist"');

  // ─────────────────────────────────────────────────────────────────
  // USERS
  // ─────────────────────────────────────────────────────────────────
  await createTableIfMissing('users', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.string('email', 255).notNullable().unique();
    t.string('username', 50).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('display_name', 100);
    t.text('bio');
    t.string('avatar_url', 500);
    t.enum('role', ['user', 'moderator', 'admin']).notNullable().defaultTo('user');
    t.enum('status', ['active', 'suspended', 'banned']).notNullable().defaultTo('active');
    t.boolean('is_bot').notNullable().defaultTo(false);
    t.boolean('email_verified').notNullable().defaultTo(false);
    t.string('email_verification_token', 255);
    t.timestamp('email_verified_at');
    t.timestamp('last_login_at');
    t.string('last_login_ip', 45);
    t.integer('failed_login_attempts').notNullable().defaultTo(0);
    t.timestamp('locked_until');
    t.jsonb('preferences').notNullable().defaultTo('{}');
    t.timestamps(true, true);
    t.index(['email']);
    t.index(['username']);
    t.index(['role']);
    t.index(['status']);
    t.index(['created_at']);
  });

  // ─────────────────────────────────────────────────────────────────
  // REFRESH TOKENS
  // ─────────────────────────────────────────────────────────────────
  await createTableIfMissing('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 255).notNullable().unique();
    t.string('device_info', 500);
    t.string('ip_address', 45);
    t.boolean('is_revoked').notNullable().defaultTo(false);
    t.timestamp('expires_at').notNullable();
    t.timestamps(true, true);
    t.index(['user_id']);
    t.index(['token_hash']);
    t.index(['expires_at']);
  });

  // ─────────────────────────────────────────────────────────────────
  // BALANCES
  // ─────────────────────────────────────────────────────────────────
  await createTableIfMissing('balances', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE').unique();
    t.decimal('available', 20, 8).notNullable().defaultTo(0);
    t.decimal('reserved', 20, 8).notNullable().defaultTo(0); // locked in open orders
    t.decimal('total', 20, 8).notNullable().defaultTo(0);    // available + reserved
    t.string('currency', 10).notNullable().defaultTo('WX');
    t.integer('version').notNullable().defaultTo(0); // optimistic locking
    t.timestamps(true, true);
    t.index(['user_id']);
  });

  // ─────────────────────────────────────────────────────────────────
  // CASH RESERVES (new columns; reserved shares are tracked in positions)
  // ─────────────────────────────────────────────────────────────────
  await db.schema.raw(`
    ALTER TABLE balances
    ADD COLUMN IF NOT EXISTS available_cash decimal(20, 8);
  `);
  await db.schema.raw(`
    ALTER TABLE balances
    ADD COLUMN IF NOT EXISTS reserved_cash decimal(20, 8);
  `);
  // Backfill for existing rows (best-effort)
  await db.schema.raw(`
    UPDATE balances
    SET available_cash = COALESCE(available_cash, available),
        reserved_cash = COALESCE(reserved_cash, reserved);
  `);

  // ─────────────────────────────────────────────────────────────────
  // BALANCE TRANSACTIONS (audit log)
  // ─────────────────────────────────────────────────────────────────
  await createTableIfMissing('balance_transactions', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.enum('type', [
      'deposit',
      'withdrawal',
      'trade_debit',
      'trade_credit',
      'fee',
      'adjustment',
      'refund',
      'purchase',
      'ad_reward',
      'signup_bonus',
    ]).notNullable();
    t.decimal('amount', 20, 8).notNullable();
    t.decimal('balance_before', 20, 8).notNullable();
    t.decimal('balance_after', 20, 8).notNullable();
    t.string('reference_type', 50); // 'trade', 'order', 'market_resolution'
    t.uuid('reference_id');
    t.text('description');
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    t.index(['user_id']);
    t.index(['type']);
    t.index(['reference_id']);
    t.index(['created_at']);
    t.index(['user_id', 'created_at']);
  });

  // ─────────────────────────────────────────────────────────────────
  // MARKETS
  // ─────────────────────────────────────────────────────────────────
  await createTableIfMissing('market_categories', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.string('name', 100).notNullable().unique();
    t.string('slug', 100).notNullable().unique();
    t.text('description');
    t.string('icon', 100);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await createTableIfMissing('markets', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('creator_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.uuid('category_id').references('id').inTable('market_categories').onDelete('SET NULL');
    t.string('title', 500).notNullable();
    t.text('description').notNullable();
    t.text('resolution_criteria').notNullable();
    t.string('image_url', 500);
    t.enum('status', ['pending', 'active', 'paused', 'resolved', 'cancelled', 'expired'])
      .notNullable().defaultTo('pending');
    t.enum('outcome', ['yes', 'no', 'invalid']).nullable();
    t.decimal('initial_liquidity', 20, 8).notNullable().defaultTo(0);
    t.decimal('liquidity_b', 20, 8).notNullable(); // LMSR b parameter
    t.decimal('yes_shares', 20, 8).notNullable().defaultTo(0);
    t.decimal('no_shares', 20, 8).notNullable().defaultTo(0);
    t.decimal('current_yes_price', 10, 8).notNullable().defaultTo(0.5);
    t.decimal('current_no_price', 10, 8).notNullable().defaultTo(0.5);
    t.decimal('volume_24h', 20, 8).notNullable().defaultTo(0);
    t.decimal('volume_total', 20, 8).notNullable().defaultTo(0);
    t.decimal('liquidity_total', 20, 8).notNullable().defaultTo(0);
    t.integer('trade_count').notNullable().defaultTo(0);
    t.integer('unique_traders').notNullable().defaultTo(0);
    t.timestamp('closes_at').notNullable();
    t.timestamp('resolved_at');
    t.uuid('resolved_by');
    t.text('resolution_note');
    t.boolean('is_featured').notNullable().defaultTo(false);
    t.jsonb('tags').notNullable().defaultTo('[]');
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.string('external_source', 50);
    t.string('external_id', 100);
    t.integer('version').notNullable().defaultTo(0); // optimistic locking
    t.timestamps(true, true);
    t.index(['creator_id']);
    t.index(['category_id']);
    t.index(['status']);
    t.index(['closes_at']);
    t.index(['created_at']);
    t.index(['is_featured']);
    t.index(['volume_24h']);
    t.index(['current_yes_price']);
  });

  // Full-text search index
  await db.raw(`
    CREATE INDEX IF NOT EXISTS markets_fts_idx 
    ON markets USING gin(to_tsvector('english', title || ' ' || description))
  `);

  // ─────────────────────────────────────────────────────────────────
  // ORDER BOOK
  // ─────────────────────────────────────────────────────────────────
  await createTableIfMissing('orders', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.uuid('market_id').notNullable().references('id').inTable('markets').onDelete('RESTRICT');
    t.enum('side', ['yes', 'no']).notNullable();
    t.enum('type', ['market', 'limit']).notNullable();
    t.enum('action', ['buy', 'sell']).notNullable();
    t.enum('status', ['pending', 'open', 'partially_filled', 'filled', 'cancelled', 'expired', 'rejected'])
      .notNullable().defaultTo('pending');
    t.decimal('price', 10, 8); // null for market orders
    t.decimal('quantity', 20, 8).notNullable();
    t.decimal('filled_quantity', 20, 8).notNullable().defaultTo(0);
    t.decimal('remaining_quantity', 20, 8).notNullable();
    t.decimal('average_fill_price', 10, 8);
    t.decimal('total_cost', 20, 8); // reserved from balance
    t.decimal('fee_amount', 20, 8).notNullable().defaultTo(0);
    t.timestamp('expires_at');
    t.text('cancel_reason');
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamps(true, true);
    t.index(['user_id']);
    t.index(['market_id']);
    t.index(['status']);
    t.index(['side']);
    t.index(['type']);
    t.index(['created_at']);
    t.index(['market_id', 'side', 'price', 'status']); // order book query
    t.index(['user_id', 'status']);
  });

  // ─────────────────────────────────────────────────────────────────
  // TRADES (executed transactions)
  // ─────────────────────────────────────────────────────────────────
  await createTableIfMissing('trades', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('market_id').notNullable().references('id').inTable('markets').onDelete('RESTRICT');
    t.uuid('buyer_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.uuid('seller_id').references('id').inTable('users').onDelete('RESTRICT');
    t.uuid('buyer_order_id').references('id').inTable('orders').onDelete('SET NULL');
    t.uuid('seller_order_id').references('id').inTable('orders').onDelete('SET NULL');
    t.enum('side', ['yes', 'no']).notNullable();
    t.enum('trade_type', ['order_book']).notNullable().defaultTo('order_book');
    t.decimal('price', 10, 8).notNullable();
    t.decimal('quantity', 20, 8).notNullable();
    t.decimal('total_value', 20, 8).notNullable();
    t.decimal('fee', 20, 8).notNullable().defaultTo(0);
    t.decimal('yes_price_before', 10, 8).notNullable();
    t.decimal('yes_price_after', 10, 8).notNullable();
    t.decimal('price_impact', 10, 8).notNullable().defaultTo(0);
    t.timestamp('executed_at').notNullable().defaultTo(db.fn.now());
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.index(['market_id']);
    t.index(['buyer_id']);
    t.index(['seller_id']);
    t.index(['executed_at']);
    t.index(['market_id', 'executed_at']);
    t.index(['side']);
  });

  // ─────────────────────────────────────────────────────────────────
  // POSITIONS
  // ─────────────────────────────────────────────────────────────────
  await createTableIfMissing('positions', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.uuid('market_id').notNullable().references('id').inTable('markets').onDelete('RESTRICT');
    t.enum('side', ['yes', 'no']).notNullable();
    t.decimal('quantity', 20, 8).notNullable().defaultTo(0);
    // Shares locked by open LIMIT SELL orders.
    // Invariant: available_shares + reserved_quantity = quantity
    t.decimal('reserved_quantity', 20, 8).notNullable().defaultTo(0);
    t.decimal('average_price', 10, 8).notNullable().defaultTo(0); // WAP
    t.decimal('total_invested', 20, 8).notNullable().defaultTo(0);
    t.decimal('realized_pnl', 20, 8).notNullable().defaultTo(0);
    t.decimal('unrealized_pnl', 20, 8).notNullable().defaultTo(0);
    t.integer('trade_count').notNullable().defaultTo(0);
    t.timestamp('last_trade_at');
    t.integer('version').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['user_id', 'market_id', 'side']);
    t.index(['user_id']);
    t.index(['market_id']);
    t.index(['user_id', 'market_id']);
  });

  // Backfill reserved_quantity for existing rows (best-effort)
  await db.schema.raw(`
    ALTER TABLE positions
    ADD COLUMN IF NOT EXISTS reserved_quantity decimal(20, 8) NOT NULL DEFAULT 0;
  `);

  // ─────────────────────────────────────────────────────────────────
  // PRICE HISTORY (time-series)
  // ─────────────────────────────────────────────────────────────────
  await createTableIfMissing('price_history', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('market_id').notNullable().references('id').inTable('markets').onDelete('CASCADE');
    t.decimal('yes_price', 10, 8).notNullable();
    t.decimal('no_price', 10, 8).notNullable();
    t.decimal('volume', 20, 8).notNullable().defaultTo(0);
    t.integer('trade_count').notNullable().defaultTo(0);
    t.timestamp('recorded_at').notNullable().defaultTo(db.fn.now());
    t.index(['market_id']);
    t.index(['recorded_at']);
    t.index(['market_id', 'recorded_at']);
  });

  // OHLCV candles table (pre-aggregated for performance)
  await createTableIfMissing('price_candles', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('market_id').notNullable().references('id').inTable('markets').onDelete('CASCADE');
    t.enum('resolution', ['1m', '5m', '15m', '1h', '4h', '1d', '1w']).notNullable();
    t.timestamp('open_time').notNullable();
    t.timestamp('close_time').notNullable();
    t.decimal('open', 10, 8).notNullable();
    t.decimal('high', 10, 8).notNullable();
    t.decimal('low', 10, 8).notNullable();
    t.decimal('close', 10, 8).notNullable();
    t.decimal('volume', 20, 8).notNullable().defaultTo(0);
    t.integer('trade_count').notNullable().defaultTo(0);
    t.unique(['market_id', 'resolution', 'open_time']);
    t.index(['market_id', 'resolution', 'open_time']);
    t.index(['open_time']);
  });

  // ─────────────────────────────────────────────────────────────────
  // LIQUIDITY EVENTS
  // ─────────────────────────────────────────────────────────────────
  await createTableIfMissing('liquidity_events', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('market_id').notNullable().references('id').inTable('markets').onDelete('RESTRICT');
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.enum('type', ['add', 'remove', 'initial']).notNullable();
    t.decimal('amount', 20, 8).notNullable();
    t.decimal('total_liquidity_before', 20, 8).notNullable();
    t.decimal('total_liquidity_after', 20, 8).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    t.index(['market_id']);
    t.index(['user_id']);
    t.index(['created_at']);
  });

  // ─────────────────────────────────────────────────────────────────
  // ACTIVITY FEED
  // ─────────────────────────────────────────────────────────────────
  await createTableIfMissing('activity_feed', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.uuid('market_id').references('id').inTable('markets').onDelete('CASCADE');
    t.enum('type', [
      'trade', 'market_created', 'market_resolved', 'market_cancelled',
      'order_placed', 'order_cancelled', 'position_opened', 'position_closed',
    ]).notNullable();
    t.jsonb('data').notNullable().defaultTo('{}');
    t.boolean('is_public').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    t.index(['market_id']);
    t.index(['user_id']);
    t.index(['type']);
    t.index(['created_at']);
    t.index(['market_id', 'created_at']);
    t.index(['user_id', 'created_at']);
  });

  // ─────────────────────────────────────────────────────────────────
  // MARKET REPORTS (admin moderation)
  // ─────────────────────────────────────────────────────────────────
  await createTableIfMissing('market_reports', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('market_id').notNullable().references('id').inTable('markets').onDelete('CASCADE');
    t.uuid('reporter_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.uuid('reviewer_id').references('id').inTable('users').onDelete('SET NULL');
    t.enum('reason', ['spam', 'misleading', 'offensive', 'duplicate', 'other']).notNullable();
    t.text('description');
    t.enum('status', ['pending', 'reviewed', 'dismissed']).notNullable().defaultTo('pending');
    t.text('review_note');
    t.timestamp('reviewed_at');
    t.timestamps(true, true);
    t.index(['market_id']);
    t.index(['reporter_id']);
    t.index(['status']);
  });

  // ─────────────────────────────────────────────────────────────────
  // INCREMENTAL: virtual currency, bots, Polymarket ingest, economy
  // ─────────────────────────────────────────────────────────────────
  await db.schema.raw(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;
  `);

  await db.schema.raw(`
    UPDATE balances SET currency = 'WX' WHERE currency IS DISTINCT FROM 'WX';
  `);
  await db.schema.raw(`
    ALTER TABLE balances ALTER COLUMN currency SET DEFAULT 'WX';
  `);

  await db.schema.raw(`
    ALTER TABLE markets
    ADD COLUMN IF NOT EXISTS external_source varchar(50);
  `);
  await db.schema.raw(`
    ALTER TABLE markets
    ADD COLUMN IF NOT EXISTS external_id varchar(100);
  `);
  await db.schema.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS markets_external_uidx
    ON markets (external_source, external_id)
    WHERE external_id IS NOT NULL;
  `);

  await addEnumValueIfMissing('balance_transactions_type', 'purchase');
  await addEnumValueIfMissing('balance_transactions_type', 'ad_reward');
  await addEnumValueIfMissing('balance_transactions_type', 'signup_bonus');

  await createTableIfMissing('coin_packages', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.string('slug', 50).notNullable().unique();
    t.string('name', 100).notNullable();
    t.decimal('wx_amount', 20, 8).notNullable();
    t.decimal('price_rub', 12, 2).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  await createTableIfMissing('coin_purchases', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.uuid('package_id').notNullable().references('id').inTable('coin_packages').onDelete('RESTRICT');
    t.decimal('wx_amount', 20, 8).notNullable();
    t.decimal('price_rub', 12, 2).notNullable();
    t.string('provider', 50).notNullable().defaultTo('mock');
    t.string('provider_ref', 255);
    t.enum('status', ['pending', 'succeeded', 'failed']).notNullable().defaultTo('pending');
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    t.timestamp('completed_at');
    t.index(['user_id']);
    t.index(['status']);
    t.index(['provider_ref']);
  });

  await createTableIfMissing('ad_rewards', (t) => {
    t.uuid('id').primary().defaultTo(db.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.decimal('wx_amount', 20, 8).notNullable();
    t.string('provider', 50).notNullable().defaultTo('mock');
    t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    t.index(['user_id', 'created_at']);
  });

  logger.info('✅ Database migrations completed');
}

async function addEnumValueIfMissing(_enumName: string, value: string): Promise<void> {
  const safeValue = value.replace(/[^a-z0-9_]/gi, '');
  await db.raw(`
    DO $$
    DECLARE
      tname text;
    BEGIN
      SELECT t.typname INTO tname
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE e.enumlabel = 'deposit'
      GROUP BY t.typname
      LIMIT 1;
      IF tname IS NOT NULL THEN
        EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', tname, '${safeValue}');
      END IF;
    END $$;
  `);
}
