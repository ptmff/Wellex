import Decimal from 'decimal.js';
import type { Knex } from 'knex';
import { config } from '../../config';
import { InsufficientBalanceError, NotFoundError } from '../../common/errors';

export type LedgerType =
  | 'deposit'
  | 'withdrawal'
  | 'trade_debit'
  | 'trade_credit'
  | 'fee'
  | 'adjustment'
  | 'refund'
  | 'purchase'
  | 'ad_reward'
  | 'signup_bonus'
  | 'daily_bonus';

export async function creditWx(
  trx: Knex.Transaction,
  userId: string,
  amount: Decimal.Value,
  type: LedgerType,
  description: string,
  meta?: { referenceType?: string; referenceId?: string; metadata?: Record<string, unknown> }
): Promise<{ balanceBefore: Decimal; balanceAfter: Decimal }> {
  const credit = new Decimal(amount);
  if (credit.lte(0)) {
    throw new Error('Credit amount must be positive');
  }

  const balance = await trx('balances').where('user_id', userId).forUpdate().first();
  if (!balance) throw new NotFoundError('Balance', userId);

  const availableBefore = new Decimal(balance.available_cash ?? balance.available);
  const reserved = new Decimal(balance.reserved_cash ?? balance.reserved);
  const availableAfter = availableBefore.plus(credit);

  await trx('balances')
    .where('id', balance.id)
    .update({
      available_cash: availableAfter.toFixed(8),
      available: availableAfter.toFixed(8),
      total: availableAfter.plus(reserved).toFixed(8),
      currency: config.CURRENCY_CODE,
      version: (balance.version ?? 0) + 1,
      updated_at: new Date(),
    });

  await trx('balance_transactions').insert({
    user_id: userId,
    type,
    amount: credit.toFixed(8),
    balance_before: availableBefore.toFixed(8),
    balance_after: availableAfter.toFixed(8),
    description,
    reference_type: meta?.referenceType ?? null,
    reference_id: meta?.referenceId ?? null,
    metadata: JSON.stringify(meta?.metadata ?? {}),
  });

  return { balanceBefore: availableBefore, balanceAfter: availableAfter };
}

export async function debitWx(
  trx: Knex.Transaction,
  userId: string,
  amount: Decimal.Value,
  type: LedgerType,
  description: string,
  meta?: { referenceType?: string; referenceId?: string; metadata?: Record<string, unknown> }
): Promise<{ balanceBefore: Decimal; balanceAfter: Decimal }> {
  const debit = new Decimal(amount);
  if (debit.lte(0)) {
    throw new Error('Debit amount must be positive');
  }

  const balance = await trx('balances').where('user_id', userId).forUpdate().first();
  if (!balance) throw new NotFoundError('Balance', userId);

  const availableBefore = new Decimal(balance.available_cash ?? balance.available);
  const reserved = new Decimal(balance.reserved_cash ?? balance.reserved);
  assertHasCash(availableBefore, debit);
  const availableAfter = availableBefore.minus(debit);

  await trx('balances')
    .where('id', balance.id)
    .update({
      available_cash: availableAfter.toFixed(8),
      available: availableAfter.toFixed(8),
      total: availableAfter.plus(reserved).toFixed(8),
      currency: config.CURRENCY_CODE,
      version: (balance.version ?? 0) + 1,
      updated_at: new Date(),
    });

  await trx('balance_transactions').insert({
    user_id: userId,
    type,
    amount: debit.toFixed(8),
    balance_before: availableBefore.toFixed(8),
    balance_after: availableAfter.toFixed(8),
    description,
    reference_type: meta?.referenceType ?? null,
    reference_id: meta?.referenceId ?? null,
    metadata: JSON.stringify(meta?.metadata ?? {}),
  });

  return { balanceBefore: availableBefore, balanceAfter: availableAfter };
}

export function assertHasCash(available: Decimal.Value, required: Decimal.Value): void {
  const avail = new Decimal(available);
  const need = new Decimal(required);
  if (avail.lt(need)) {
    throw new InsufficientBalanceError(avail.toNumber(), need.toNumber());
  }
}
