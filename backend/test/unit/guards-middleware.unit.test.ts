jest.mock('../../src/database/connection', () => ({ db: jest.fn() }));
jest.mock('../../src/infrastructure/redis/cache.service', () => ({
  userCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));

import { z } from 'zod';
import { requireRole, requireAdminKey, requireOwnerOrAdmin } from '../../src/common/guards';
import { validate, sanitizeResponse, requestId } from '../../src/common/middleware';
import { ErrorCode } from '../../src/common/errors';

const run = (mw: any, req: any) => new Promise<any>((resolve) => { const r = mw(req, {}, (err?: any) => resolve(err)); if (r?.then) r.then(() => undefined); });

describe('common/guards — RBAC', () => {
  it('requireRole uses the hierarchy user < moderator < admin', async () => {
    const mw = requireRole('moderator', 'admin');
    expect(await run(mw, { user: { role: 'user' } })).toMatchObject({ code: ErrorCode.FORBIDDEN });
    expect(await run(mw, { user: { role: 'moderator' } })).toBeUndefined();
    expect(await run(mw, { user: { role: 'admin' } })).toBeUndefined();
    expect(await run(requireRole('admin'), { user: { role: 'moderator' } })).toMatchObject({ statusCode: 403 });
    expect(await run(mw, {})).toMatchObject({ statusCode: 401 });
  });

  it('requireAdminKey compares the X-Admin-Key header with ADMIN_SECRET_KEY', async () => {
    expect(await run(requireAdminKey, { headers: { 'x-admin-key': 'test-admin-key' } })).toBeUndefined();
    expect(await run(requireAdminKey, { headers: { 'x-admin-key': 'wrong' } })).toMatchObject({ statusCode: 403 });
    expect(await run(requireAdminKey, { headers: {} })).toMatchObject({ statusCode: 403 });
  });

  it('requireOwnerOrAdmin lets the owner and admins through, rejects others', async () => {
    const mw = requireOwnerOrAdmin(() => 'owner-id');
    expect(await run(mw, { user: { id: 'owner-id', role: 'user' } })).toBeUndefined();
    expect(await run(mw, { user: { id: 'x', role: 'admin' } })).toBeUndefined();
    expect(await run(mw, { user: { id: 'x', role: 'user' } })).toMatchObject({ statusCode: 403 });
    expect(await run(mw, {})).toMatchObject({ statusCode: 401 });
  });
});

describe('common/middleware', () => {
  it('validate() replaces the source with parsed data or forwards a 422 ValidationError', async () => {
    const mw = validate(z.object({ n: z.coerce.number().int() }), 'query');
    const ok: any = { query: { n: '5' } };
    expect(await run(mw, ok)).toBeUndefined();
    expect(ok.query.n).toBe(5);
    const err = await run(mw, { query: { n: 'x' } });
    expect(err).toMatchObject({ statusCode: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(err.details[0].field).toBe('n');
  });

  it('sanitizeResponse() strips password_hash / email tokens recursively and serialises dates', () => {
    const sent: any[] = [];
    const res: any = { json: (b: any) => { sent.push(b); return res; } };
    sanitizeResponse()({} as any, res, () => undefined);
    const d = new Date('2026-01-01T00:00:00Z');
    res.json({ user: { id: 1, password_hash: 'h', email_verification_token: 't', createdAt: d }, list: [{ password_hash: 'x', a: 1 }] });
    expect(sent[0]).toEqual({ user: { id: 1, createdAt: '2026-01-01T00:00:00.000Z' }, list: [{ a: 1 }] });
  });

  it('requestId() attaches a UUID', async () => {
    const req: any = {};
    await run(requestId(), req);
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
