// Sampan Pay webhooks on the fake network: Standard Webhooks signatures (checked with the reference library),
// retries with the same webhook-id, a queue that survives a restart, no repeat after a 2xx, nothing sent for a
// convert the network does not know, and no request to a private address (at creation and at every attempt).
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Webhook } from 'standardwebhooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { parseAddress } from '../core/address.js';
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { buildApp } from '../server/app.js';
import type { FakeChain } from '../server/chain/fake.js';
import { webhookHeaders } from '../server/pay/sign.js';
import type { Lookup, Transport, WebhookTarget } from '../server/pay/ssrf.js';
import type { StoredPayment } from '../server/pay/store.js';
import { createServices, type Services } from '../server/services.js';
import { userTokenAddress } from './helpers/wallet.js';

const base = normalizeConfig(shipped as unknown as SampanConfig);
const config = patchConfig(base, JSON.stringify({ features: { pay: true }, rate: { invoicesPerHour: 1000, quotesPerMinute: 1000 } }));
const SECRET = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
const DEMO_SECRET = `whsec_${Buffer.alloc(32, 9).toString('base64')}`;
const HOOK = 'https://shop.example/hook';

interface Sent {
  target: WebhookTarget;
  headers: Record<string, string>;
  body: string;
}

let dir: string;
let app: FastifyInstance;
let services: Services;
let sent: Sent[];
let answers: Array<number | Error>;
let dns: Record<string, string[]>;

const lookup: Lookup = async (host) => {
  const ips = dns[host];
  if (!ips) throw new Error('ENOTFOUND');
  return ips;
};
const transport: Transport = async (target, headers, body) => {
  sent.push({ target, headers, body });
  const a = answers.shift() ?? 200;
  if (a instanceof Error) throw a;
  return a;
};

const start = async (c: SampanConfig = config, demoSecret: string | undefined = DEMO_SECRET): Promise<void> => {
  services = createServices({
    config: c,
    fake: true,
    dbFile: path.join(dir, 'sampan.db'),
    trustedProxies: [],
    fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json'),
    webhookLookup: lookup,
    webhookTransport: transport,
  });
  app = await buildApp({ config: c, webDist: dir, fake: true, services, startWatcher: false, payDemoSecret: demoSecret });
};

const t0 = new Date('2026-11-16T12:00:00Z').getTime();
const at = (ms: number): void => void vi.setSystemTime(t0 + ms);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
  dir = mkdtempSync(path.join(tmpdir(), 'sampan-hook-'));
  sent = [];
  answers = [];
  dns = { 'shop.example': ['93.184.215.14'] };
  await start();
});
afterEach(async () => {
  await app.close();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
const invoice = async (body: object = {}): Promise<{ id: string; address: string; requiredSats: string }> => {
  const res = await post('/api/pay/invoice', { usd: 0.2, merchantAddress: userTokenAddress, webhookUrl: HOOK, webhookSecret: SECRET, ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; address: string; requiredSats: string };
};
let coinNo = 0;
const pay = async (inv: { id: string; address: string }, sats: bigint): Promise<void> => {
  const lock = parseAddress(inv.address, 'bitcoincash');
  if (typeof lock === 'string') throw new Error(lock);
  coinNo += 1;
  (services.chain as FakeChain).add(lock.lockingHex, { txid: coinNo.toString(16).padStart(64, 'c'), vout: 0, sats, height: 0 });
  expect(await services.watcher.kick(services.pay.store.get(inv.id)!.crossing_id)).toBe(true);
};
const paidInvoice = async () => {
  const inv = await invoice();
  await pay(inv, BigInt(inv.requiredSats));
  return inv;
};
const verify = (s: Sent) => new Webhook(SECRET).verify(s.body, s.headers) as { type: string; data: { id: string; status: string; convert: unknown[] } };

describe('Sampan Pay webhooks', () => {
  it('signs so the Standard Webhooks reference library accepts it, after the convert is read back', async () => {
    const inv = await paidInvoice();
    await services.webhooks.tick();
    expect(sent).toHaveLength(1);
    const msg = verify(sent[0]!);
    expect(msg.type).toBe('invoice.paid');
    expect(msg.data).toMatchObject({ id: inv.id, status: 'paid' });
    expect(msg.data.convert).toHaveLength(1);
    expect(sent[0]!.target.ip).toBe('93.184.215.14');
    expect(services.pay.view(inv.id)!.webhook).toEqual({ state: 'delivered', attempts: 1 });
  });

  it('retries 500, 500, 200 with the same webhook-id and fresh timestamps, then stops', async () => {
    await paidInvoice();
    answers = [500, 500, 200];
    const waits = config.pay.webhook.retrySeconds;
    await services.webhooks.tick();
    at(waits[0]! * 1000 - 1);
    await services.webhooks.tick();
    expect(sent).toHaveLength(1); // not due yet
    at(waits[0]! * 1000);
    await services.webhooks.tick();
    at((waits[0]! + waits[1]!) * 1000);
    await services.webhooks.tick();
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((s) => s.headers['webhook-id'])).size).toBe(1);
    expect(new Set(sent.map((s) => s.headers['webhook-timestamp'])).size).toBe(3);
    expect(new Set(sent.map((s) => s.body)).size).toBe(1);
    for (const s of sent) verify(s);
    const [event] = services.webhooks.events(verify(sent[0]!).data.id);
    expect(event).toMatchObject({ state: 'delivered', attempts: 3 });
    // Delivered: later ticks and a status read send nothing more.
    at(10 * 3600_000);
    services.pay.view(event!.invoice_id);
    await services.webhooks.tick();
    expect(sent).toHaveLength(3);
  });

  it('retries after a timeout and gives up after the last wait', async () => {
    const inv = await paidInvoice();
    const waits = config.pay.webhook.retrySeconds;
    answers = Array.from({ length: waits.length + 1 }, () => new Error('no answer within 5000 ms'));
    let t = 0;
    await services.webhooks.tick();
    for (const w of waits) {
      t += w * 1000;
      at(t);
      await services.webhooks.tick();
    }
    expect(sent).toHaveLength(waits.length + 1);
    expect(services.webhooks.events(inv.id)[0]).toMatchObject({ state: 'failed', attempts: waits.length + 1 });
    expect(services.pay.view(inv.id)!.webhook.state).toBe('failed');
  });

  it('picks the queue up again after a restart, with the same webhook-id', async () => {
    const inv = await paidInvoice();
    answers = [500];
    await services.webhooks.tick();
    await app.close();
    sent.length = 0;
    await start();
    at(config.pay.webhook.retrySeconds[0]! * 1000);
    await services.webhooks.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers['webhook-id']).toBe(services.webhooks.events(inv.id)[0]!.id);
    expect(services.webhooks.events(inv.id)[0]).toMatchObject({ state: 'delivered', attempts: 2 });
  });

  it('sends nothing for a convert written into the database that the network does not know', async () => {
    const inv = await invoice();
    const coin = `${'d'.repeat(64)}:0`;
    const forged: StoredPayment[] = [{ coin, sats: inv.requiredSats, seenAt: t0, action: 'converted', finishTxid: 'e'.repeat(64), tokens: '20' }];
    services.pay.store.update(inv.id, { payments_json: JSON.stringify(forged), status: 'paid' });
    let t = 0;
    for (let i = 0; i <= config.pay.webhook.retrySeconds.length + 1; i++) {
      await services.webhooks.tick();
      t += 7200_000;
      at(t);
    }
    expect(sent).toEqual([]);
    expect(services.webhooks.events(inv.id)[0]).toMatchObject({ state: 'failed' });
    expect(services.webhooks.events(inv.id)[0]!.last_error).toMatch(/not on the network/);
  });

  it('waits for the convert before telling the merchant the invoice is paid', async () => {
    const inv = await invoice();
    const coin = `${'d'.repeat(64)}:0`;
    services.pay.store.update(inv.id, {
      payments_json: JSON.stringify([{ coin, sats: inv.requiredSats, seenAt: t0, action: 'waiting' }]),
      status: 'paid',
    });
    await services.webhooks.tick();
    expect(sent).toEqual([]);
    expect(services.webhooks.events(inv.id)[0]).toMatchObject({ state: 'pending', attempts: 0 });
  });

  it('sends invoice.expired for an unpaid invoice once its time is up', async () => {
    const inv = await invoice();
    await services.webhooks.tick();
    expect(sent).toEqual([]);
    at(config.pay.validMinutes * 60_000);
    await services.webhooks.tick();
    expect(sent.map((s) => verify(s).type)).toEqual(['invoice.expired']);
    expect(verify(sent[0]!).data.id).toBe(inv.id);
  });

  it('refuses webhook URLs that are not https or reach a private address', async () => {
    dns['inside.example'] = ['93.184.215.14', '10.1.2.3'];
    dns['meta.example'] = ['169.254.169.254'];
    for (const webhookUrl of [
      'http://shop.example/hook',
      'https://127.0.0.1/hook',
      'https://10.0.0.5/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/hook',
      'https://[::ffff:127.0.0.1]/hook',
      'https://inside.example/hook',
      'https://meta.example/hook',
      'https://nowhere.example/hook',
      'https://user:pw@shop.example/hook',
    ]) {
      const res = await post('/api/pay/invoice', { usd: 0.2, merchantAddress: userTokenAddress, webhookUrl });
      expect(res.statusCode, webhookUrl).toBe(400);
    }
  });

  it('checks the address again before sending (a name that now resolves to a private address gets no request)', async () => {
    const inv = await paidInvoice();
    dns['shop.example'] = ['192.168.1.20'];
    await services.webhooks.tick();
    expect(sent).toEqual([]);
    expect(services.webhooks.events(inv.id)[0]!.last_error).toMatch(/private/);
  });
});

describe('demo shop hook', () => {
  const message = (id: string, type = 'invoice.paid') => JSON.stringify({ type, timestamp: new Date().toISOString(), data: { id } });
  const deliver = (body: string, secret = DEMO_SECRET, ts = Math.floor(Date.now() / 1000)) =>
    app.inject({ method: 'POST', url: '/api/pay/demo-hook', headers: { 'content-type': 'application/json', ...webhookHeaders(secret, 'msg_1', ts, body) }, payload: body });

  it('marks a demo order fulfilled only with a good signature and a fresh timestamp', async () => {
    const inv = await invoice();
    services.demoOrders.add(inv.id);
    const body = message(inv.id);
    expect((await deliver(body, SECRET)).statusCode).toBe(401);
    expect((await deliver(body, DEMO_SECRET, Math.floor(Date.now() / 1000) - 301)).statusCode).toBe(401);
    expect((await deliver(body.replace('paid', 'paid '), DEMO_SECRET)).statusCode).toBe(200); // signed as sent, but not a fulfilling event
    expect(services.demoOrders.get(inv.id)!.fulfilled_at).toBeNull();
    const ok = await deliver(body);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(services.demoOrders.get(inv.id)).toMatchObject({ fulfilled_at: Date.now(), event: 'invoice.paid' });
  });

  it('refuses an order the demo shop never made, and is 404 without the secret', async () => {
    expect((await deliver(message('f'.repeat(32)))).statusCode).toBe(404);
    await app.close();
    await start(config, undefined);
    expect((await deliver(message('f'.repeat(32)))).statusCode).toBe(404);
  });
});
