import { db } from '../connection';
import { logger } from '../../common/logger';
import bcrypt from 'bcryptjs';
import { config } from '../../config';
import Decimal from 'decimal.js';

export async function runSeeds(): Promise<void> {
  logger.info('Running seeds...');

  // ── Categories
  const categories = [
    { name: 'Politics', slug: 'politics', icon: '🏛️' },
    { name: 'Technology', slug: 'technology', icon: '💻' },
    { name: 'Sports', slug: 'sports', icon: '⚽' },
    { name: 'Finance', slug: 'finance', icon: '📈' },
    { name: 'Science', slug: 'science', icon: '🔬' },
    { name: 'Entertainment', slug: 'entertainment', icon: '🎬' },
    { name: 'Crypto', slug: 'crypto', icon: '🪙' },
    { name: 'World Events', slug: 'world-events', icon: '🌍' },
  ];

  await db('market_categories')
    .insert(categories)
    .onConflict('slug')
    .ignore();

  // ── Demo users
  const passwordHash = await bcrypt.hash('Password123', 12);

  const users = [
    { email: 'admin@example.com', username: 'admin', password_hash: passwordHash, role: 'admin', display_name: 'Admin' },
    { email: 'moderator@example.com', username: 'moderator', password_hash: passwordHash, role: 'moderator', display_name: 'Moderator' },
    // Internal fee sink account for exchange/platform fees.
    { email: 'exchange@example.com', username: 'exchange', password_hash: passwordHash, role: 'admin', display_name: 'Exchange' },
    { email: 'alice@example.com', username: 'alice', password_hash: passwordHash, role: 'user', display_name: 'Alice' },
    { email: 'bob@example.com', username: 'bob', password_hash: passwordHash, role: 'user', display_name: 'Bob' },
    { email: 'charlie@example.com', username: 'charlie', password_hash: passwordHash, role: 'user', display_name: 'Charlie' },
  ];

  for (const user of users) {
    const [existing] = await db('users').where('email', user.email).select('id');
    if (existing) continue;

    const [newUser] = await db('users').insert(user).returning('id');

    await db('balances').insert({
      user_id: newUser.id,
      available: config.INITIAL_USER_BALANCE.toFixed(8),
      reserved: '0',
      total: config.INITIAL_USER_BALANCE.toFixed(8),
      available_cash: config.INITIAL_USER_BALANCE.toFixed(8),
      reserved_cash: '0',
      currency: 'USD',
    });

    await db('balance_transactions').insert({
      user_id: newUser.id,
      type: 'deposit',
      amount: config.INITIAL_USER_BALANCE.toFixed(8),
      balance_before: '0',
      balance_after: config.INITIAL_USER_BALANCE.toFixed(8),
      description: 'Initial demo balance (seed)',
    });
  }

  // ── Sample markets
  const adminUser = await db('users').where('username', 'admin').first();
  const techCategory = await db('market_categories').where('slug', 'technology').first();
  const politicsCategory = await db('market_categories').where('slug', 'politics').first();
  const cryptoCategory = await db('market_categories').where('slug', 'crypto').first();

  const sampleMarkets = [
    {
      title: 'Will GPT-5 be released before end of 2025?',
      description: 'OpenAI has been developing the next generation of their flagship language model. This market resolves YES if OpenAI officially releases a model called GPT-5 to the public before December 31, 2025.',
      resolution_criteria: 'Official OpenAI announcement of GPT-5 public release before Dec 31, 2025.',
      category_id: techCategory?.id,
      closes_at: new Date('2025-12-31'),
      initial_liquidity: 500,
      tags: JSON.stringify(['AI', 'OpenAI', 'GPT']),
      is_featured: true,
    },
    {
      title: 'Will Bitcoin exceed $150,000 by end of 2025?',
      description: 'Bitcoin has seen significant price action recently. This market resolves YES if Bitcoin (BTC) trades at or above $150,000 USD on any major exchange before December 31, 2025.',
      resolution_criteria: 'BTC/USD price on Binance, Coinbase, or Kraken reaches $150,000.',
      category_id: cryptoCategory?.id,
      closes_at: new Date('2025-12-31'),
      initial_liquidity: 1000,
      tags: JSON.stringify(['Bitcoin', 'Crypto', 'Price']),
      is_featured: true,
    },
    {
      title: 'Will there be a major AI regulation bill passed in the US in 2025?',
      description: 'Congress has been debating AI regulation. This market resolves YES if a comprehensive AI regulation bill is signed into law by the US President before December 31, 2025.',
      resolution_criteria: 'A comprehensive federal AI regulation bill signed into law.',
      category_id: politicsCategory?.id,
      closes_at: new Date('2025-12-31'),
      initial_liquidity: 300,
      tags: JSON.stringify(['AI', 'Regulation', 'US', 'Policy']),
      is_featured: false,
    },
  ];

  for (const market of sampleMarkets) {
    const exists = await db('markets').where('title', market.title).first();
    if (exists) continue;

    const b = new Decimal(market.initial_liquidity).div(Math.LN2);

    await db('markets').insert({
      creator_id: adminUser.id,
      ...market,
      status: 'active',
      liquidity_b: b.toFixed(8),
      yes_shares: '0',
      no_shares: '0',
      current_yes_price: '0.5',
      current_no_price: '0.5',
      liquidity_total: market.initial_liquidity,
      metadata: '{}',
    });
  }

  logger.info('✅ Seeds completed');
}

runSeeds()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Seeds failed', { error: err.message });
    process.exit(1);
  });
