/**
 * WebSocket events (/ws) and HTTP rate limiting on the real app.
 */
import WebSocket from 'ws';
import { API, bearer, createTestApp } from '../helpers/app';
import { createMarket, createUser, settle } from '../helpers/db';

type Msg = { type: string; payload: any; timestamp: string };

function connect(port: number): Promise<{ ws: WebSocket; messages: Msg[]; next: (type: string, ms?: number) => Promise<Msg> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: Msg[] = [];
    const waiters: Array<{ type: string; fn: (m: Msg) => void }> = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as Msg;
      messages.push(m);
      const i = waiters.findIndex((w) => w.type === m.type);
      if (i >= 0) waiters.splice(i, 1)[0].fn(m);
    });
    const next = (type: string, ms = 2000) =>
      new Promise<Msg>((res, rej) => {
        const t = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), ms);
        waiters.push({ type, fn: (m) => { clearTimeout(t); res(m); } });
      });
    const welcome = next('heartbeat');
    ws.on('open', async () => {
      await welcome;
      resolve({ ws, messages, next });
    });
    ws.on('error', reject);
  });
}

describe('WebSocket /ws', () => {
  let t: ReturnType<typeof createTestApp>;
  let port: number;
  beforeAll(async () => {
    t = createTestApp();
    port = await t.listen();
  });
  afterAll(async () => {
    await t.close();
  });
  afterEach(async () => {
    await settle(100);
  });

  it('greets a new client with a heartbeat containing clientId and answers ping', async () => {
    const c = await connect(port);
    expect(c.messages[0].type).toBe('heartbeat');
    expect(typeof c.messages[0].payload.clientId).toBe('string');
    const pong = c.next('heartbeat');
    c.ws.send(JSON.stringify({ type: 'ping' }));
    expect((await pong).payload.ts).toEqual(expect.any(Number));
    c.ws.close();
  });

  it('auth: invalid token -> error; portfolio subscription requires auth; valid token -> subscribed', async () => {
    const u = await createUser();
    const c = await connect(port);
    let e = c.next('error');
    c.ws.send(JSON.stringify({ type: 'subscribe_portfolio' }));
    expect((await e).payload.message).toBe('Authentication required');

    e = c.next('error');
    c.ws.send(JSON.stringify({ type: 'auth', token: 'bad' }));
    expect((await e).payload.message).toBe('Invalid token');

    let s = c.next('subscribed');
    c.ws.send(JSON.stringify({ type: 'auth', token: u.token }));
    expect((await s).payload.userId).toBe(u.id);
    s = c.next('subscribed');
    c.ws.send(JSON.stringify({ type: 'subscribe_portfolio' }));
    expect((await s).payload.channel).toBe('portfolio');

    e = c.next('error');
    c.ws.send('{not json');
    expect((await e).payload.message).toBe('Invalid JSON');
    c.ws.close();
  });

  it('market subscribers receive an orderbook price_update after an order is placed via the API', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id);
    const c = await connect(port);
    const sub = c.next('subscribed');
    c.ws.send(JSON.stringify({ type: 'subscribe_market', marketId }));
    await sub;

    const update = c.next('price_update', 3000);
    await t.api().post(`${API}/orders/${marketId}`).set(bearer(u.token)).send({ side: 'yes', action: 'buy', price: 0.4, quantity: 2 }).expect(201);
    const m = await update;
    expect(m.payload).toMatchObject({ type: 'orderbook_update', marketId });
    c.ws.close();
  });

  // BUG-09: known defect, see docs/test-report/README.md. it.failing passes while the bug exists;
  // once the bug is fixed this test starts failing -> switch it back to it(...).
  it.failing('[BUG-09] each market event is delivered to a subscriber exactly once', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id);
    const c = await connect(port);
    const sub = c.next('subscribed');
    c.ws.send(JSON.stringify({ type: 'subscribe_market', marketId }));
    await sub;

    await t.api().post(`${API}/orders/${marketId}`).set(bearer(u.token)).send({ side: 'yes', action: 'buy', price: 0.4, quantity: 2 }).expect(201);
    await settle(800);
    const updates = c.messages.filter((m) => m.type === 'price_update');
    expect(updates).toHaveLength(1);
    c.ws.close();
  });

  it('unsubscribed clients stop receiving market events', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id);
    const c = await connect(port);
    let s = c.next('subscribed');
    c.ws.send(JSON.stringify({ type: 'subscribe_market', marketId }));
    await s;
    s = c.next('unsubscribed');
    c.ws.send(JSON.stringify({ type: 'unsubscribe_market', marketId }));
    await s;
    await t.api().post(`${API}/orders/${marketId}`).set(bearer(u.token)).send({ side: 'yes', action: 'buy', price: 0.4, quantity: 1 }).expect(201);
    await settle(500);
    expect(c.messages.filter((m) => m.type === 'price_update')).toHaveLength(0);
    c.ws.close();
  });
});

describe('Rate limiting', () => {
  let t: ReturnType<typeof createTestApp>;
  beforeEach(() => {
    t = createTestApp();
  });
  afterEach(async () => {
    await settle(50);
    await t.close();
  });

  it('auth endpoints: 20 requests per 15 min per IP, the 21st gets 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const r = await t.api().post(`${API}/auth/login`).send({ email: 'nobody@test.local', password: 'x' });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it('trading endpoints: 30 requests per minute, the 31st gets 429', async () => {
    const u = await createUser();
    const marketId = await createMarket(u.id);
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await t.api().post(`${API}/trading/${marketId}/quote`).send({ side: 'yes', action: 'buy', amount: 1 })).status;
      if (i < 30) expect(last).not.toBe(429);
    }
    expect(last).toBe(429);
  });

  // BUG-10: known defect, see docs/test-report/README.md. it.failing passes while the bug exists;
  // once the bug is fixed this test starts failing -> switch it back to it(...).
  it.failing('[BUG-10] trading limiter is per user: another user is not throttled by the first user\'s 30 requests', async () => {
    const a = await createUser();
    const b = await createUser();
    const marketId = await createMarket(a.id);
    for (let i = 0; i < 30; i++) {
      await t.api().post(`${API}/trading/${marketId}/trade`).set(bearer(a.token)).send({ side: 'yes', action: 'buy', amount: 1 });
    }
    const rb = await t.api().post(`${API}/trading/${marketId}/trade`).set(bearer(b.token)).send({ side: 'yes', action: 'buy', amount: 1 });
    expect(rb.status).not.toBe(429);
  });
});
