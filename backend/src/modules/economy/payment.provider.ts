import { config } from '../../config';
import { YooKassaPaymentProvider } from './payment.yookassa';

/**
 * Payment provider port.
 * Mock credits immediately. YooKassa returns a hosted confirmation URL; WX is credited on webhook / status sync.
 */
export type PaymentChargeInput = {
  userId: string;
  purchaseId: string;
  packageSlug: string;
  packageName: string;
  wxAmount: number;
  priceRub: number;
  customerEmail?: string;
};

export type PaymentChargeResult = {
  provider: string;
  providerRef: string;
  status: 'succeeded' | 'pending' | 'failed';
  confirmationUrl?: string | null;
};

export type PaymentLookup = {
  providerRef: string;
  status: 'succeeded' | 'pending' | 'failed' | 'canceled';
  paid: boolean;
  amountValue: string;
  metadata: Record<string, string>;
};

export interface PaymentProvider {
  readonly name: string;
  createCharge(input: PaymentChargeInput): Promise<PaymentChargeResult>;
  getPayment(providerRef: string): Promise<PaymentLookup>;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  async createCharge(input: PaymentChargeInput): Promise<PaymentChargeResult> {
    return {
      provider: this.name,
      providerRef: `mock_${input.purchaseId}`,
      status: 'succeeded',
      confirmationUrl: null,
    };
  }

  async getPayment(providerRef: string): Promise<PaymentLookup> {
    return {
      providerRef,
      status: 'succeeded',
      paid: true,
      amountValue: '0',
      metadata: {},
    };
  }
}

export function createPaymentProvider(): PaymentProvider {
  if (config.PAYMENT_PROVIDER === 'yookassa') {
    return new YooKassaPaymentProvider();
  }
  return new MockPaymentProvider();
}

export const paymentProvider: PaymentProvider = createPaymentProvider();
