import { db } from '../connection';
import { logger } from '../../common/logger';
import bcrypt from 'bcryptjs';
import { config } from '../../config';

type SeedUser = {
  email: string;
  username: string;
  password_hash: string;
  role: string;
  display_name: string;
  is_bot?: boolean;
};

export async function runSeeds(): Promise<void> {
  logger.info('Running seeds...');

  const categories = [
    { name: 'Politics', slug: 'politics', icon: 'politics' },
    { name: 'Technology', slug: 'technology', icon: 'technology' },
    { name: 'Sports', slug: 'sports', icon: 'sports' },
    { name: 'Finance', slug: 'finance', icon: 'finance' },
    { name: 'Science', slug: 'science', icon: 'science' },
    { name: 'Entertainment', slug: 'entertainment', icon: 'entertainment' },
    { name: 'Crypto', slug: 'crypto', icon: 'crypto' },
    { name: 'World Events', slug: 'world-events', icon: 'world-events' },
  ];

  await db('market_categories').insert(categories).onConflict('slug').ignore();

  await db('coin_packages')
    .insert([
      { slug: 'starter', name: 'Starter', wx_amount: '500', price_rub: '49.00', sort_order: 1 },
      { slug: 'pack', name: 'Pack', wx_amount: '2000', price_rub: '149.00', sort_order: 2 },
      { slug: 'whale', name: 'Whale', wx_amount: '5000', price_rub: '299.00', sort_order: 3 },
    ])
    .onConflict('slug')
    .ignore();

  const passwordHash = await bcrypt.hash('Password123', 12);

  const users: SeedUser[] = [
    { email: 'admin@example.com', username: 'admin', password_hash: passwordHash, role: 'admin', display_name: 'Admin' },
    { email: 'moderator@example.com', username: 'moderator', password_hash: passwordHash, role: 'moderator', display_name: 'Moderator' },
    { email: 'exchange@example.com', username: 'exchange', password_hash: passwordHash, role: 'admin', display_name: 'Exchange' },
    { email: 'alice@example.com', username: 'alice', password_hash: passwordHash, role: 'user', display_name: 'Alice' },
    { email: 'bob@example.com', username: 'bob', password_hash: passwordHash, role: 'user', display_name: 'Bob' },
    { email: 'charlie@example.com', username: 'charlie', password_hash: passwordHash, role: 'user', display_name: 'Charlie' },
    {
      email: 'bot.ingest@example.com',
      username: 'bot_ingest',
      password_hash: passwordHash,
      role: 'moderator',
      display_name: 'Ingest Bot',
      is_bot: true,
    },
    {
      email: 'bot.mm1@example.com',
      username: 'bot_mm_1',
      password_hash: passwordHash,
      role: 'user',
      display_name: 'Market Maker 1',
      is_bot: true,
    },
    {
      email: 'bot.mm2@example.com',
      username: 'bot_mm_2',
      password_hash: passwordHash,
      role: 'user',
      display_name: 'Market Maker 2',
      is_bot: true,
    },
    {
      email: 'bot.mm3@example.com',
      username: 'bot_mm_3',
      password_hash: passwordHash,
      role: 'user',
      display_name: 'Market Maker 3',
      is_bot: true,
    },
  ];

  for (let i = 1; i <= 12; i += 1) {
    users.push({
      email: `trader${i}@example.com`,
      username: `trader${i}`,
      password_hash: passwordHash,
      role: 'user',
      display_name: `Trader ${i}`,
    });
  }

  for (const user of users) {
    const isBot = Boolean(user.is_bot);
    const starting = (isBot ? config.BOT_USER_BALANCE : config.INITIAL_USER_BALANCE).toFixed(8);

    let userId: string;
    const existing = await db('users')
      .where('email', user.email)
      .orWhere('username', user.username)
      .first();
    if (existing) {
      userId = existing.id;
      await db('users').where('id', userId).update({
        email: user.email,
        username: user.username,
        is_bot: isBot,
        role: user.role,
        display_name: user.display_name,
        updated_at: new Date(),
      });
    } else {
      const [newUser] = await db('users')
        .insert({
          email: user.email,
          username: user.username,
          password_hash: user.password_hash,
          role: user.role,
          display_name: user.display_name,
          is_bot: isBot,
        })
        .returning('id');
      userId = newUser.id;
    }

    const existingBalance = await db('balances').where('user_id', userId).first();
    if (!existingBalance) {
      await db('balances').insert({
        user_id: userId,
        available: starting,
        reserved: '0',
        total: starting,
        available_cash: starting,
        reserved_cash: '0',
        currency: config.CURRENCY_CODE,
      });
    } else {
      await db('balances').where('user_id', userId).update({ currency: config.CURRENCY_CODE });
      if (isBot) {
        await db('balances').where('user_id', userId).update({
          available: starting,
          available_cash: starting,
          total: starting,
          reserved: '0',
          reserved_cash: '0',
        });
      }
    }

    const bonusLabel = isBot ? 'Bot treasury (seed)' : `Welcome bonus ${config.CURRENCY_CODE} (seed)`;
    const existingDeposit = await db('balance_transactions')
      .where('user_id', userId)
      .andWhere('description', bonusLabel)
      .first();

    if (!existingDeposit && !existingBalance) {
      await db('balance_transactions').insert({
        user_id: userId,
        type: isBot ? 'deposit' : 'signup_bonus',
        amount: starting,
        balance_before: '0',
        balance_after: starting,
        description: bonusLabel,
      });
    }
  }

  logger.info('✅ Seeds completed');
}
