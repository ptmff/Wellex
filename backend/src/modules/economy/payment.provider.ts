/**
 * Payment provider port.
 * Mock succeeds immediately. Swap for YooKassa/Stripe later without changing EconomyService.
 */
export type PaymentChargeInput = {
  userId: string;
  purchaseId: string;
  packageSlug: string;
  wxAmount: number;
  priceRub: number;
};

export type PaymentChargeResult = {
  provider: string;
  providerRef: string;
  status: 'succeeded' | 'pending' | 'failed';
};

export interface PaymentProvider {
  readonly name: string;
  createCharge(input: PaymentChargeInput): Promise<PaymentChargeResult>;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  async createCharge(input: PaymentChargeInput): Promise<PaymentChargeResult> {
    return {
      provider: this.name,
      providerRef: `mock_${input.purchaseId}`,
      status: 'succeeded',
    };
  }
}

export const paymentProvider: PaymentProvider = new MockPaymentProvider();
