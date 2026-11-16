// The demo shop on /pay through the API on the fake network: checkout makes an invoice to the configured test-wallet
// address with the shop's own webhook; paying it on the fake chain converts, the webhook goes to the demo hook of the
// same server in-process (signed), and only then is the order fulfilled. Flag off or no secret = 404 everywhere,
// and the merchant script and example page are the static 404 page.
import type { FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { normalizeConfig, patchConfig, publicConfig, type SampanConfig } from '../core/config.js';
import { PAY_FILES } from '../server/api/pay.js';
import { buildApp } from '../server/app.js';
import { createServices, type Services } from '../server/services.js';

const base = normalizeConfig(shipped as unknown as SampanConfig);
// The flag off whatever the shipped config says (it ships on once the measured runs exist).
const off = patchConfig(base, JSON.stringify({ features: { pay: false } }));
const on = patchConfig(base, JSON.stringify({ features: { pay: true }, rate: { invoicesPerHour: 1000, quotesPerMinute: 1000 } }));
const DEMO_SECRET = `whsec_${Buffer.alloc(32, 5).toString('base64')}`;
let app: FastifyInstance | undefined;
let services: Services;
let dist: string;

const start = async (c: SampanConfig, secret: string | null = DEMO_SECRET, fake = true) => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-shop-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(path.join(dist, 'pay.js'), '/* button */');
  mkdirSync(path.join(dist, 'pay'));
  writeFileSync(path.join(dist, 'pay', 'example.html'), '<!doctype html><title>example</title>');
  services = createServices({ config: c, fake, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config: c, webDist: dist, fake, services, startWatcher: false, payDemoSecret: secret ?? undefined });
  return app;
};
afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(dist, { recursive: true, force: true });
});

const post = (a: FastifyInstance, url: string, payload: object = {}) => a.inject({ method: 'POST', url, payload });
const get = (a: FastifyInstance, url: string) => a.inject({ method: 'GET', url });

describe('demo shop', () => {
  it('is 404 with the flag off: checkout, order lookup, fake payment, merchant script and example page', async () => {
    const a = await start(off);
    expect((await post(a, '/api/pay/demo/order')).statusCode).toBe(404);
    expect((await get(a, `/api/pay/demo/order/${'a'.repeat(32)}`)).statusCode).toBe(404);
    expect((await post(a, `/api/pay/fake/pay/${'a'.repeat(32)}`)).statusCode).toBe(404);
    for (const file of ['/pay.js', '/pay.js?v=1', '/pay/example.html']) {
      const res = await get(a, file);
      expect(res.statusCode, file).toBe(404);
      expect(res.headers['content-type'], file).toMatch(/text\/html/);
    }
    // The page route itself stays the app (the front page answers for every unknown page path).
    expect((await get(a, '/pay')).statusCode).toBe(200);
  });

  it('serves the merchant script and example page with the flag on', async () => {
    const a = await start(on);
    expect((await get(a, '/pay.js')).body).toBe('/* button */');
    expect((await get(a, '/pay/example.html')).statusCode).toBe(200);
  });

  it('matches only the two pay files', () => {
    expect(['/pay.js', '/pay/example.html', '/pay/example.css', '/pay.js?v=abc'].every((u) => PAY_FILES.test(u))).toBe(true);
    expect(['/pay', '/pay/i/abc', '/payjs', '/pay.json', '/api/pay/invoice', '/pay/a/b.html'].some((u) => PAY_FILES.test(u))).toBe(false);
  });

  it('is 404 without the host secret even with the flag on', async () => {
    const a = await start(on, null);
    expect((await post(a, '/api/pay/demo/order')).statusCode).toBe(404);
  });

  it('has no fake routes on the real network', async () => {
    const a = await start(on, DEMO_SECRET, false);
    expect((await post(a, `/api/pay/fake/pay/${'a'.repeat(32)}`)).statusCode).toBe(404);
    expect((await post(a, `/api/pay/fake/expire/${'a'.repeat(32)}`)).statusCode).toBe(404);
  });

  it('shows the page what it needs from the pay block, and nothing secret', () => {
    const pay = publicConfig(on).pay;
    expect(pay).toEqual({ validMinutes: on.pay.validMinutes, minUsd: on.pay.minUsd, maxUsd: on.pay.maxUsd, demoPriceUsd: on.pay.demo.priceUsd });
  });

  it('checkout, payment, convert, signed webhook, fulfilled', async () => {
    const a = await start(on);
    const res = await post(a, '/api/pay/demo/order');
    expect(res.statusCode, res.body).toBe(200);
    const { id, statusUrl } = res.json() as { id: string; statusUrl: string };
    expect(statusUrl).toBe(`/pay/i/${id}`);
    const inv = (await get(a, `/api/pay/invoice/${id}`)).json() as { usd: string; status: string; orderId: string; returnUrl: string };
    expect(Number(inv.usd)).toBe(on.pay.demo.priceUsd);
    expect(inv.status).toBe('open');
    expect(inv.orderId).toMatch(/^demo-[0-9a-f]{12}$/);
    expect(inv.returnUrl).toBe(`${on.site.url}/pay`);
    const row = services.pay.store.get(id)!;
    expect(row.merchant_address).toBe(on.pay.demo.merchantAddress);
    expect(row.webhook_url).toBe(`${on.site.url}/api/pay/demo-hook`);
    expect((await get(a, `/api/pay/demo/order/${id}`)).json()).toEqual({ fulfilled: false, fulfilledAt: null, event: null });

    expect((await post(a, `/api/pay/fake/pay/${id}`)).statusCode).toBe(200);
    const paid = (await get(a, `/api/pay/invoice/${id}`)).json() as { status: string; convert: unknown[] };
    expect(paid.status).toBe('paid');
    expect(paid.convert).toHaveLength(1);
    await services.webhooks.tick();
    await services.webhooks.tick();
    const order = (await get(a, `/api/pay/demo/order/${id}`)).json() as { fulfilled: boolean; fulfilledAt: string; event: string };
    expect(order.fulfilled).toBe(true);
    expect(order.event).toBe('invoice.paid');
    expect(Number.isNaN(Date.parse(order.fulfilledAt))).toBe(false);
    expect(services.webhooks.events(id).some((e) => e.state === 'delivered')).toBe(true);
  });

  it('a half payment is underpaid and the order is not handed over; expiry is reported', async () => {
    const a = await start(on);
    const { id } = (await post(a, '/api/pay/demo/order')).json() as { id: string };
    await post(a, `/api/pay/fake/pay/${id}`, { part: 'short' });
    expect(((await get(a, `/api/pay/invoice/${id}`)).json() as { status: string }).status).toBe('underpaid');
    await services.webhooks.tick();
    await services.webhooks.tick();
    expect(((await get(a, `/api/pay/demo/order/${id}`)).json() as { fulfilled: boolean }).fulfilled).toBe(false);

    const other = ((await post(a, '/api/pay/demo/order')).json() as { id: string }).id;
    expect((await post(a, `/api/pay/fake/expire/${other}`)).statusCode).toBe(200);
    expect(((await get(a, `/api/pay/invoice/${other}`)).json() as { status: string }).status).toBe('expired');
  });

  it('the fake transport refuses every address but the demo hook of this site', async () => {
    const a = await start(on);
    void a;
    const transport = (await import('../server/pay/fake.js')).fakeTransport(on, services.fakeDelivery);
    const url = (u: string) => ({ url: new URL(u), ip: '203.0.113.10' });
    expect(await transport(url('https://example.com/api/pay/demo-hook'), {}, '{}', 1000)).toBe(503);
    expect(await transport(url(`${on.site.url}/api/pay/invoice`), {}, '{}', 1000)).toBe(503);
    // The right address with an unsigned body reaches the hook, which refuses it.
    expect(await transport(url(`${on.site.url}/api/pay/demo-hook`), { 'content-type': 'application/json' }, '{}', 1000)).toBe(401);
  });
});
