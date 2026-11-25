/**
 * API tests (supertest) for /api/v1/auth on the real Express app, Postgres and Redis.
 */
import jwt from 'jsonwebtoken';
import { db } from '../../src/database/connection';
import { redisClient } from '../../src/infrastructure/redis/cache.service';
import { config } from '../../src/config';
import { API, bearer, createTestApp } from '../helpers/app';
import { createUser, PASSWORD, settle } from '../helpers/db';

const validRegistration = (suffix: string) => ({
  email: `Alice_${suffix}@Example.com`,
  username: `alice_${suffix}`,
  password: 'StrongPass1',
  legalConsent: true,
});

describe('API /auth', () => {
  let t: ReturnType<typeof createTestApp>;
  // a fresh app per test => fresh in-memory rate-limit counters (auth limiter: 20 req / 15 min / IP)
  beforeEach(() => {
    t = createTestApp();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await settle(50);
    await t.close();
  });

  it('POST /register -> 201, returns token pair, creates balance 1000 WX and signup_bonus ledger entry', async () => {
    const res = await t.api().post(`${API}/auth/register`).send(validRegistration('a1'));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ expiresIn: 900, user: { email: 'alice_a1@example.com', role: 'user' } });
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.body.data.refreshToken).toHaveLength(128);
    expect(JSON.stringify(res.body)).not.toContain('password_hash');

    const userId = res.body.data.user.id;
    const bal = await db('balances').where('user_id', userId).first();
    expect(Number(bal.available_cash)).toBe(1000);
    expect(await db('balance_transactions').where({ user_id: userId, type: 'signup_bonus' })).toHaveLength(1);
  });

  it('POST /register: duplicate email -> 409, weak password / no consent -> 422', async () => {
    await t.api().post(`${API}/auth/register`).send(validRegistration('dup')).expect(201);
    const dup = await t.api().post(`${API}/auth/register`).send({ ...validRegistration('dup'), username: 'other_name' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');

    const weak = await t.api().post(`${API}/auth/register`).send({ ...validRegistration('w'), password: 'weak' });
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    const noConsent = await t.api().post(`${API}/auth/register`).send({ ...validRegistration('nc'), legalConsent: false });
    expect(noConsent.status).toBe(422);
  });

  it('POST /login -> 200 with valid credentials; wrong password -> 401 INVALID_CREDENTIALS; unknown email -> 401', async () => {
    const u = await createUser();
    const ok = await t.api().post(`${API}/auth/login`).send({ email: u.email, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.id).toBe(u.id);

    const bad = await t.api().post(`${API}/auth/login`).send({ email: u.email, password: 'WrongPass1' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    const unknown = await t.api().post(`${API}/auth/login`).send({ email: 'nobody@test.local', password: 'x' });
    expect(unknown.status).toBe(401);
  });

  it('5 failed logins lock the account for 15 minutes: even the correct password is refused with ACCOUNT_LOCKED', async () => {
    const u = await createUser();
    for (let i = 0; i < 5; i++) {
      const r = await t.api().post(`${API}/auth/login`).send({ email: u.email, password: 'WrongPass1' });
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    const row = await db('users').where('id', u.id).first();
    expect(row.failed_login_attempts).toBe(5);
    const lockMinutes = (new Date(row.locked_until).getTime() - Date.now()) / 60000;
    expect(lockMinutes).toBeGreaterThan(14);
    expect(lockMinutes).toBeLessThanOrEqual(15);

    const locked = await t.api().post(`${API}/auth/login`).send({ email: u.email, password: PASSWORD });
    expect(locked.status).toBe(401);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('suspended account cannot log in (403 ACCOUNT_SUSPENDED)', async () => {
    const u = await createUser({ status: 'suspended' });
    const r = await t.api().post(`${API}/auth/login`).send({ email: u.email, password: PASSWORD });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('POST /refresh rotates tokens; reusing the old refresh token revokes the whole token family', async () => {
    // Pin Math.random so the 5% opportunistic clean-up in generateTokenPair() does not run here:
    // when it runs it deletes revoked tokens and defeats reuse detection (BUG-06, covered by its own test).
    // Without the pin this test failed in 1 of 3 repeated runs (docs/test-report/logs/03-stability-3-runs.log).
    const rnd = jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const u = await createUser();
    const login = await t.api().post(`${API}/auth/login`).send({ email: u.email, password: PASSWORD });
    const rt1 = login.body.data.refreshToken;

    const r1 = await t.api().post(`${API}/auth/refresh`).send({ refreshToken: rt1 });
    expect(r1.status).toBe(200);
    const rt2 = r1.body.data.refreshToken;
    expect(rt2).not.toBe(rt1);

    const reuse = await t.api().post(`${API}/auth/refresh`).send({ refreshToken: rt1 });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.message).toBe('Token reuse detected');

    const afterReuse = await t.api().post(`${API}/auth/refresh`).send({ refreshToken: rt2 });
    expect(afterReuse.status).toBe(401);
    const active = await db('refresh_tokens').where({ user_id: u.id, is_revoked: false });
    expect(active).toHaveLength(0);
    rnd.mockRestore();
  });

  it('refresh: missing token -> 400, random token -> 401, expired token -> 401 TOKEN_EXPIRED', async () => {
    const u = await createUser();
    expect((await t.api().post(`${API}/auth/refresh`).send({})).status).toBe(400);
    expect((await t.api().post(`${API}/auth/refresh`).send({ refreshToken: 'deadbeef' })).status).toBe(401);

    const login = await t.api().post(`${API}/auth/login`).send({ email: u.email, password: PASSWORD });
    await db('refresh_tokens').where({ user_id: u.id }).update({ expires_at: new Date(Date.now() - 1000) });
    const r = await t.api().post(`${API}/auth/refresh`).send({ refreshToken: login.body.data.refreshToken });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TOKEN_EXPIRED');
  });

  // BUG-06: known defect, see docs/test-report/README.md. it.failing passes while the bug exists;
  // once the bug is fixed this test starts failing -> switch it back to it(...).
  it.failing('[BUG-06] reuse detection still works when the opportunistic token clean-up has run (revoked tokens are not deleted)', async () => {
    const u = await createUser();
    const login = await t.api().post(`${API}/auth/login`).send({ email: u.email, password: PASSWORD });
    const rt1 = login.body.data.refreshToken;

    // generateTokenPair() runs a clean-up with probability 5% (Math.random() < 0.05); force that branch
    const rnd = jest.spyOn(Math, 'random').mockReturnValue(0.01);
    const r1 = await t.api().post(`${API}/auth/refresh`).send({ refreshToken: rt1 });
    rnd.mockRestore();
    await settle(200);
    const rt2 = r1.body.data.refreshToken;

    const reuse = await t.api().post(`${API}/auth/refresh`).send({ refreshToken: rt1 });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.message).toBe('Token reuse detected');
    // the attacker's stolen-token replay must invalidate the rotated token as well
    expect((await t.api().post(`${API}/auth/refresh`).send({ refreshToken: rt2 })).status).toBe(401);
  });

  it('GET /me requires a valid access token (none -> 401, garbage -> TOKEN_INVALID, expired -> TOKEN_EXPIRED)', async () => {
    const u = await createUser();
    const ok = await t.api().get(`${API}/auth/me`).set(bearer(u.token));
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ id: u.id, role: 'user' });
    expect(await redisClient.exists(`pm:users:user:${u.id}`)).toBe(1); // user cached for 60s

    expect((await t.api().get(`${API}/auth/me`)).status).toBe(401);
    const garbage = await t.api().get(`${API}/auth/me`).set(bearer('not.a.jwt'));
    expect(garbage.body.error.code).toBe('TOKEN_INVALID');
    const expired = jwt.sign({ sub: u.id, role: 'user', jti: 'x' }, config.JWT_ACCESS_SECRET, { expiresIn: -10 });
    const exp = await t.api().get(`${API}/auth/me`).set(bearer(expired));
    expect(exp.status).toBe(401);
    expect(exp.body.error.code).toBe('TOKEN_EXPIRED');
    const forged = jwt.sign({ sub: u.id, role: 'admin', jti: 'x' }, 'another-secret-another-secret-123456');
    expect((await t.api().get(`${API}/auth/me`).set(bearer(forged))).status).toBe(401);
  });

  it('POST /logout revokes the refresh token and drops the cached user', async () => {
    const u = await createUser();
    const login = await t.api().post(`${API}/auth/login`).send({ email: u.email, password: PASSWORD });
    await t.api().get(`${API}/auth/me`).set(bearer(u.token)).expect(200);

    const out = await t.api().post(`${API}/auth/logout`).set(bearer(u.token)).send({ refreshToken: login.body.data.refreshToken });
    expect(out.status).toBe(200);
    expect(await redisClient.exists(`pm:users:user:${u.id}`)).toBe(0);
    const r = await t.api().post(`${API}/auth/refresh`).send({ refreshToken: login.body.data.refreshToken });
    expect(r.status).toBe(401);
  });

  it('PATCH /password changes the password and revokes all refresh tokens', async () => {
    const u = await createUser();
    const login = await t.api().post(`${API}/auth/login`).send({ email: u.email, password: PASSWORD });
    const wrong = await t.api().patch(`${API}/auth/password`).set(bearer(u.token)).send({ currentPassword: 'nope', newPassword: 'NewStrong1' });
    expect(wrong.status).toBe(401);
    const ok = await t.api().patch(`${API}/auth/password`).set(bearer(u.token)).send({ currentPassword: PASSWORD, newPassword: 'NewStrong1' });
    expect(ok.status).toBe(200);
    expect((await t.api().post(`${API}/auth/refresh`).send({ refreshToken: login.body.data.refreshToken })).status).toBe(401);
    expect((await t.api().post(`${API}/auth/login`).send({ email: u.email, password: 'NewStrong1' })).status).toBe(200);
  });
});
