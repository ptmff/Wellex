jest.mock('../../src/database/connection', () => ({ db: jest.fn() }));
jest.mock('../../src/infrastructure/redis/cache.service', () => {
  const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  return { userCache: cache, portfolioCache: cache, CacheService: jest.fn(() => cache), redisClient: {} };
});

import jwt from 'jsonwebtoken';
import { PlaceLimitOrderDto, ListOrdersDto } from '../../src/modules/orders/orderbook.service';
import { RegisterDto, LoginDto, AuthService } from '../../src/modules/auth/auth.service';
import { assertHasCash } from '../../src/modules/economy/wallet';
import { MockPaymentProvider, createPaymentProvider } from '../../src/modules/economy/payment.provider';
import { CreateMarketDto } from '../../src/modules/markets/markets.service';
import { ErrorCode } from '../../src/common/errors';
import { config } from '../../src/config';

describe('DTO validation (zod schemas from src)', () => {
  it('PlaceLimitOrderDto: price strictly inside (0,1), positive quantity, enums', () => {
    expect(PlaceLimitOrderDto.safeParse({ side: 'yes', action: 'buy', price: 0.5, quantity: 1 }).success).toBe(true);
    for (const price of [0, 1, -0.1, 1.2]) {
      expect(PlaceLimitOrderDto.safeParse({ side: 'yes', action: 'buy', price, quantity: 1 }).success).toBe(false);
    }
    expect(PlaceLimitOrderDto.safeParse({ side: 'yes', action: 'buy', price: 0.5, quantity: 0 }).success).toBe(false);
    expect(PlaceLimitOrderDto.safeParse({ side: 'maybe', action: 'buy', price: 0.5, quantity: 1 }).success).toBe(false);
    expect(ListOrdersDto.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('RegisterDto: email normalised to lower case, password policy, legal consent required', () => {
    const ok = RegisterDto.parse({ email: 'A@B.COM', username: 'abc', password: 'Abcdefg1', legalConsent: true });
    expect(ok.email).toBe('a@b.com');
    expect(RegisterDto.safeParse({ email: 'a@b.com', username: 'abc', password: 'abcdefg1', legalConsent: true }).success).toBe(false); // no upper
    expect(RegisterDto.safeParse({ email: 'a@b.com', username: 'abc', password: 'Abcdefgh', legalConsent: true }).success).toBe(false); // no digit
    expect(RegisterDto.safeParse({ email: 'a@b.com', username: 'a b', password: 'Abcdefg1', legalConsent: true }).success).toBe(false);
    expect(RegisterDto.safeParse({ email: 'a@b.com', username: 'abc', password: 'Abcdefg1', legalConsent: false }).success).toBe(false);
    expect(LoginDto.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });

  it('CreateMarketDto: market must close at least 1 hour from now', () => {
    const base = { title: 'A sufficiently long title', description: 'A description that is long enough.', resolutionCriteria: 'Criteria that are long enough.' };
    expect(CreateMarketDto.safeParse({ ...base, closesAt: new Date(Date.now() + 30 * 60_000).toISOString() }).success).toBe(false);
    expect(CreateMarketDto.safeParse({ ...base, closesAt: new Date(Date.now() + 2 * 3600_000).toISOString() }).success).toBe(true);
  });
});

describe('wallet / payment provider', () => {
  it('assertHasCash throws InsufficientBalanceError only when available < required', () => {
    expect(() => assertHasCash('10', '10')).not.toThrow();
    expect(() => assertHasCash(9.99, 10)).toThrow(expect.objectContaining({ code: ErrorCode.INSUFFICIENT_BALANCE }));
  });

  it('mock payment provider succeeds instantly and is selected by PAYMENT_PROVIDER=mock', async () => {
    const p = new MockPaymentProvider();
    const charge = await p.createCharge({ userId: 'u', purchaseId: 'p1', packageSlug: 's', packageName: 'S', wxAmount: 1, priceRub: 1 });
    expect(charge).toEqual({ provider: 'mock', providerRef: 'mock_p1', status: 'succeeded', confirmationUrl: null });
    expect((await p.getPayment('mock_p1')).paid).toBe(true);
    expect(createPaymentProvider().name).toBe('mock');
  });
});

describe('AuthService.verifyAccessToken', () => {
  const auth = new AuthService();
  it('accepts tokens signed with JWT_ACCESS_SECRET and distinguishes expired / invalid tokens', () => {
    const good = jwt.sign({ sub: 'u1', role: 'user', jti: 'j' }, config.JWT_ACCESS_SECRET, { expiresIn: '1m' });
    expect(auth.verifyAccessToken(good)).toMatchObject({ sub: 'u1', role: 'user' });
    const expired = jwt.sign({ sub: 'u1', role: 'user', jti: 'j' }, config.JWT_ACCESS_SECRET, { expiresIn: -1 });
    expect(() => auth.verifyAccessToken(expired)).toThrow(expect.objectContaining({ code: ErrorCode.TOKEN_EXPIRED }));
    const refreshSigned = jwt.sign({ sub: 'u1', role: 'admin', jti: 'j' }, config.JWT_REFRESH_SECRET);
    expect(() => auth.verifyAccessToken(refreshSigned)).toThrow(expect.objectContaining({ code: ErrorCode.TOKEN_INVALID }));
  });
});
