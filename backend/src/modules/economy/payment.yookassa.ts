import { randomUUID } from 'crypto';
import { config } from '../../config';
import { AppError, ErrorCode } from '../../common/errors';
import { logger } from '../../common/logger';
import type { PaymentChargeInput, PaymentChargeResult, PaymentLookup, PaymentProvider } from './payment.provider';

const YOO_API = 'https://api.yookassa.ru/v3';

type YooPaymentStatus = 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';

type YooPayment = {
  id: string;
  status: YooPaymentStatus;
  paid?: boolean;
  amount?: { value: string; currency: string };
  confirmation?: { type: string; confirmation_url?: string };
  metadata?: Record<string, string>;
  description?: string;
};

function mapStatus(status: YooPaymentStatus): PaymentLookup['status'] {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'canceled') return 'canceled';
  return 'pending';
}

function toLookup(payment: YooPayment): PaymentLookup {
  return {
    providerRef: payment.id,
    status: mapStatus(payment.status),
    paid: Boolean(payment.paid),
    amountValue: payment.amount?.value ?? '0',
    metadata: payment.metadata ?? {},
  };
}

export class YooKassaPaymentProvider implements PaymentProvider {
  readonly name = 'yookassa';

  async createCharge(input: PaymentChargeInput): Promise<PaymentChargeResult> {
    const amountValue = Number(input.priceRub).toFixed(2);
    const returnUrl = `${config.PAYMENT_RETURN_URL.replace(/\/$/, '')}?purchase=${input.purchaseId}`;

    const body: Record<string, unknown> = {
      amount: { value: amountValue, currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: returnUrl },
      description: `Wellex ${input.packageName} · ${input.wxAmount} ${config.CURRENCY_CODE}`,
      metadata: {
        purchaseId: input.purchaseId,
        userId: input.userId,
        packageSlug: input.packageSlug,
      },
    };

    const payment = await this.request<YooPayment>('POST', '/payments', body, input.purchaseId);
    const confirmationUrl = payment.confirmation?.confirmation_url ?? null;

    if (!confirmationUrl && payment.status !== 'succeeded') {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'YooKassa did not return a confirmation URL', 502);
    }

    logger.info('YooKassa payment created', {
      purchaseId: input.purchaseId,
      providerRef: payment.id,
      status: payment.status,
    });

    return {
      provider: this.name,
      providerRef: payment.id,
      status: mapStatus(payment.status) === 'succeeded' ? 'succeeded' : 'pending',
      confirmationUrl,
    };
  }

  async getPayment(providerRef: string): Promise<PaymentLookup> {
    const payment = await this.request<YooPayment>('GET', `/payments/${encodeURIComponent(providerRef)}`);
    return toLookup(payment);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    idempotenceKey?: string
  ): Promise<T> {
    const shopId = config.YOOKASSA_SHOP_ID;
    const secret = config.YOOKASSA_SECRET_KEY;
    if (!shopId || !secret) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'YooKassa credentials are not configured', 500);
    }

    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${shopId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    };
    if (method === 'POST') {
      headers['Idempotence-Key'] = idempotenceKey ?? randomUUID();
    }

    let res: Response;
    try {
      res = await fetch(`${YOO_API}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'YooKassa is unreachable', 502, {
        reason: (err as Error).message,
      });
    }

    const json = (await res.json().catch(() => ({}))) as T & { description?: string; code?: string };
    if (!res.ok) {
      logger.error('YooKassa API error', { path, status: res.status, body: json });
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        json.description ?? `YooKassa request failed (${res.status})`,
        502,
        { code: json.code }
      );
    }

    return json;
  }
}
