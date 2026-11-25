import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { db } from '../../src/database/connection';
import { redisClient } from '../../src/infrastructure/redis/cache.service';
import { config } from '../../src/config';

let tables: string[] | null = null;

/** Truncate every table of the test schema and flush the test Redis DB. */
export async function resetState(): Promise<void> {
  if (!tables) {
    const rows = await db('pg_tables').where({ schemaname: 'public' }).select('tablename');
    tables = rows.map((r: { tablename: string }) => `"${r.tablename}"`);
  }
  if (tables.length) await db.raw(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  await redisClient.flushdb();
}

export const PASSWORD = 'Passw0rdTest';
let cachedHash: string | null = null;
async function passwordHash(): Promise<string> {
  if (!cachedHash) cachedHash = await bcrypt.hash(PASSWORD, 4);
  return cachedHash;
}

export interface TestUser {
  id: string;
  email: string;
  username: string;
  role: 'user' | 'moderator' | 'admin';
  token: string;
}

export function accessTokenFor(id: string, role = 'user'): string {
  return jwt.sign({ sub: id, role, jti: randomUUID() }, config.JWT_ACCESS_SECRET, { expiresIn: '15m' });
}

export async function createUser(
  opts: { username?: string; role?: 'user' | 'moderator' | 'admin'; balance?: number; status?: string } = {}
): Promise<TestUser> {
  const username = opts.username ?? `u_${randomUUID().slice(0, 8)}`;
  const email = `${username}@test.local`;
  const balance = (opts.balance ?? 1000).toFixed(8);
  const [user] = await db('users')
    .insert({
      email,
      username,
      password_hash: await passwordHash(),
      display_name: username,
      role: opts.role ?? 'user',
      status: opts.status ?? 'active',
    })
    .returning('*');
  await db('balances').insert({
    user_id: user.id,
    available: balance,
    reserved: '0',
    total: balance,
    available_cash: balance,
    reserved_cash: '0',
    currency: 'WX',
  });
  return { id: user.id, email, username, role: user.role, token: accessTokenFor(user.id, user.role) };
}

/** Platform fee sink: the order book credits fees to the user named "exchange". */
export async function createExchange(balance = 0): Promise<TestUser> {
  return createUser({ username: 'exchange', role: 'admin', balance });
}

export async function createMarket(
  creatorId: string,
  opts: { status?: string; closesInMs?: number; yesPrice?: number; liquidity?: number } = {}
): Promise<string> {
  const yes = opts.yesPrice ?? 0.5;
  const [m] = await db('markets')
    .insert({
      creator_id: creatorId,
      title: 'Will the integration test pass today?',
      description: 'Market created by the automated integration test-suite.',
      resolution_criteria: 'Resolves YES if the test-suite passes.',
      status: opts.status ?? 'active',
      liquidity_b: '1',
      current_yes_price: yes.toFixed(8),
      current_no_price: (1 - yes).toFixed(8),
      liquidity_total: (opts.liquidity ?? 0).toFixed(8),
      closes_at: new Date(Date.now() + (opts.closesInMs ?? 7 * 24 * 3600 * 1000)),
    })
    .returning('id');
  return m.id ?? m;
}

export async function giveShares(
  userId: string,
  marketId: string,
  side: 'yes' | 'no',
  quantity: number,
  averagePrice = 0.5
): Promise<void> {
  await db('positions').insert({
    user_id: userId,
    market_id: marketId,
    side,
    quantity: quantity.toFixed(8),
    reserved_quantity: '0',
    average_price: averagePrice.toFixed(8),
    total_invested: (quantity * averagePrice).toFixed(8),
    realized_pnl: '0',
    unrealized_pnl: '0',
    trade_count: 0,
  });
}

export async function balanceOf(userId: string) {
  const b = await db('balances').where('user_id', userId).first();
  return {
    available: Number(b.available_cash),
    reserved: Number(b.reserved_cash),
    total: Number(b.total),
  };
}

export async function positionOf(userId: string, marketId: string, side: 'yes' | 'no') {
  const p = await db('positions').where({ user_id: userId, market_id: marketId, side }).first();
  if (!p) return null;
  return {
    quantity: Number(p.quantity),
    reserved: Number(p.reserved_quantity),
    averagePrice: Number(p.average_price),
    totalInvested: Number(p.total_invested),
  };
}

/** Wait for fire-and-forget side effects (setImmediate broadcasts, notifications). */
export const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));

export { db, redisClient };
