// Sampan Pay through the API on the fake network: invoices are landing addresses of the unchanged contract, unique
// per invoice, recomputed by the independent verifier; the landing finisher converts what arrives and the invoice
// reads the result. Flag off = every /api/pay route is 404.
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { parseAddress } from '../core/address.js';
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { readCard } from '../core/landing-card.js';
import { LANDING_RATE_DEN, minTokensFor } from '../core/landing.js';
import { addressFromSource } from '../scripts/verify-landing.js';
import { buildApp } from '../server/app.js';
import type { FakeChain } from '../server/chain/fake.js';
import { createServices, type Services } from '../server/services.js';
import { PUSD } from './helpers/pools.js';
import { userAddress, userTokenAddress } from './helpers/wallet.js';

const base = normalizeConfig(shipped as unknown as SampanConfig);
const on = (extra: object = {}) =>
  patchConfig(base, JSON.stringify({ features: { pay: true }, rate: { invoicesPerHour: 1000, quotesPerMinute: 1000 }, ...extra }));
let app: FastifyInstance;
let services: Services;
let dist: string;

const start = async (c: SampanConfig) => {
  services = createServices({ config: c, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config: c, webDist: dist, fake: true, services, startWatcher: false });
};
const restart = async (c: SampanConfig) => {
  await app.close();
  await start(c);
};

beforeEach(async () => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-pay-'));
  await start(on());
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  rmSync(dist, { recursive: true, force: true });
});

interface Created {
  id: string;
  address: string;
  bip21: string;
  qrSvgUrl: string;
  statusUrl: string;
  usd: string;
  requiredSats: string;
  expiresAt: string;
  webhookSecret?: string;
}
interface View {
  status: string;
  paidSats: string;
  payments: Array<{ txid: string; sats: string }>;
  convert: Array<{ txid: string; pusd: string }>;
  webhook: { state: string; attempts: number };
}

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
const invoice = async (body: object = {}): Promise<Created> => {
  const res = await post('/api/pay/invoice', { usd: 0.2, merchantAddress: userTokenAddress, ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Created;
};
const view = async (id: string): Promise<View> => {
  const res = await app.inject({ method: 'GET', url: `/api/pay/invoice/${id}` });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as View;
};
let coinNo = 0;
/** A plain BCH payment of `sats` lands at the invoice address, and the finisher runs. */
const pay = async (inv: Created, sats: bigint): Promise<void> => {
  const lock = parseAddress(inv.address, 'bitcoincash');
  if (typeof lock === 'string') throw new Error(lock);
  coinNo += 1;
  (services.chain as FakeChain).add(lock.lockingHex, { txid: coinNo.toString(16).padStart(64, 'b'), vout: 0, sats, height: 0 });
  const row = services.pay.store.get(inv.id)!;
  expect(await services.watcher.kick(row.crossing_id)).toBe(true);
};
const cardOf = (address: string) => {
  const read = readCard(JSON.parse(services.db.landingByAddress(address)!.params_json), base.pay.maxNonce);
  if (typeof read === 'string') throw new Error(read);
  return read;
};

describe('Sampan Pay API', () => {
  it('answers 404 on every route while features.pay is off', async () => {
    await restart(base);
    expect((await post('/api/pay/invoice', { usd: 0.2, merchantAddress: userTokenAddress })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/pay/invoice/${'a'.repeat(32)}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/pay/invoice/${'a'.repeat(32)}/qr.svg` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'OPTIONS', url: '/api/pay/invoice' })).statusCode).toBe(404);
  });

  it('opens an invoice address that the independent verifier recomputes, with the floor at exactly the invoice', async () => {
    const inv = await invoice({ orderId: 'order-1' });
    const { card, params } = cardOf(inv.address);
    expect(addressFromSource(card)).toBe(inv.address);
    expect(params.ownerLockHex).toBe((parseAddress(userTokenAddress, 'bitcoincash') as { lockingHex: string }).lockingHex);
    expect(params.category).toBe(PUSD);
    expect(params.rateDen > LANDING_RATE_DEN).toBe(true);
    expect(minTokensFor(params, BigInt(inv.requiredSats))).toBe(20n);
    expect(inv.usd).toBe('0.20');
    expect(inv.bip21).toBe(`${inv.address}?amount=${(Number(inv.requiredSats) / 1e8).toFixed(8).replace(/0+$/, '')}`);
    expect(inv.statusUrl).toBe(`${base.site.url}/pay/i/${inv.id}`);
    expect(inv.id).toMatch(/^[0-9a-f]{32}$/);
    expect(Date.parse(inv.expiresAt) - Date.now()).toBeLessThanOrEqual(base.pay.validMinutes * 60_000);
    const qr = await app.inject({ method: 'GET', url: `/api/pay/invoice/${inv.id}/qr.svg` });
    expect(qr.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(qr.body).toMatch(/^<svg /);
    expect(await view(inv.id)).toMatchObject({ status: 'open', paidSats: '0', payments: [], convert: [], webhook: { state: 'none', attempts: 0 } });
  });

  it('gives 200 invoices of one merchant 200 different addresses', async () => {
    const addresses = new Set<string>();
    for (let i = 0; i < 200; i++) addresses.add((await invoice()).address);
    expect(addresses.size).toBe(200);
  }, 60_000);

  it('keeps plain landing addresses at rateDen 1e8', async () => {
    await restart(on({ features: { pay: true, landing: true } }));
    const res = await post('/api/land/open', { ownerAddress: userTokenAddress, token: 'PUSD' });
    expect((res.json() as { card: { rateDen: string } }).card.rateDen).toBe(LANDING_RATE_DEN.toString());
  });

  it('refuses bad input', async () => {
    const bad = async (body: object, code?: string) => {
      const res = await post('/api/pay/invoice', { usd: 0.2, merchantAddress: userTokenAddress, ...body });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      if (code) expect((res.json() as { error: string }).error).toBe(code);
    };
    await bad({ merchantAddress: userAddress }, 'bad_request'); // not token-aware
    await bad({ merchantAddress: 'bitcoincash:qnotanaddressatallreally' }, 'bad_request');
    await bad({ usd: base.pay.minUsd - 0.01 }, 'below_min');
    await bad({ usd: base.pay.maxUsd + 1 }, 'above_max');
    await bad({ usd: 'one' }); // schema
    await bad({ usd: 0.205 }, 'bad_request');
    await bad({ webhookUrl: 'http://example.com/hook' }, 'bad_request');
    await bad({ webhookSecret: `whsec_${'A'.repeat(40)}` }, 'bad_request');
    await bad({ returnUrl: 'javascript:alert(1)' }, 'bad_request');
    await bad({ surprise: 1 }); // schema: unknown field
  });

  it('limits open invoices per merchant', async () => {
    await restart(on({ pay: { maxOpenInvoices: 2 } }));
    await invoice();
    await invoice();
    const res = await post('/api/pay/invoice', { usd: 0.2, merchantAddress: userTokenAddress });
    expect(res.statusCode).toBe(429);
    expect((res.json() as { error: string }).error).toBe('too_many_open');
  });

  it('returns a generated webhook secret once and never on GET', async () => {
    const inv = await invoice({ webhookUrl: 'https://merchant.example/hook' });
    expect(inv.webhookSecret).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    const v = await app.inject({ method: 'GET', url: `/api/pay/invoice/${inv.id}` });
    expect(v.body).not.toContain('whsec_');
    expect((v.json() as View).webhook).toEqual({ state: 'pending', attempts: 0 });
    const own = await invoice({ webhookUrl: 'https://merchant.example/hook', webhookSecret: `whsec_${'B'.repeat(40)}` });
    expect(own.webhookSecret).toBeUndefined();
  });

  it('lets other sites call /api/pay/* from a browser, and only those routes', async () => {
    const pre = await app.inject({ method: 'OPTIONS', url: '/api/pay/invoice', headers: { origin: 'https://shop.example' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('*');
    expect(pre.headers['access-control-allow-headers']).toBe('content-type');
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();
    const created = await post('/api/pay/invoice', { usd: 0.2, merchantAddress: userTokenAddress });
    expect(created.headers['access-control-allow-origin']).toBe('*');
    const cfg = await app.inject({ method: 'GET', url: '/api/config' });
    expect(cfg.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('is paid when the finisher converts a payment of requiredSats, and shows the convert', async () => {
    const inv = await invoice();
    await pay(inv, BigInt(inv.requiredSats));
    const v = await view(inv.id);
    expect(v.status).toBe('paid');
    expect(v.payments).toHaveLength(1);
    expect(v.convert).toHaveLength(1);
    expect(Number(v.convert[0]!.pusd)).toBeGreaterThanOrEqual(0.2);
    const owner = await services.chain.listUnspent((parseAddress(userTokenAddress, 'bitcoincash') as { lockingHex: string }).lockingHex);
    expect(owner.some((u) => u.txid === v.convert[0]!.txid && u.token?.category === PUSD)).toBe(true);
  });

  it('is underpaid below the tolerance and overpaid above it', async () => {
    const under = await invoice();
    await pay(under, (BigInt(under.requiredSats) * 9_000n) / 10_000n);
    expect((await view(under.id)).status).toBe('underpaid');
    const over = await invoice();
    await pay(over, BigInt(over.requiredSats) * 2n);
    expect((await view(over.id)).status).toBe('overpaid');
  });

  it('adds two payments together', async () => {
    const inv = await invoice();
    const half = BigInt(inv.requiredSats) / 2n;
    await pay(inv, half);
    expect((await view(inv.id)).status).toBe('underpaid');
    await pay(inv, BigInt(inv.requiredSats) - half);
    const v = await view(inv.id);
    expect(v.status).toBe('paid');
    expect(v.paidSats).toBe(inv.requiredSats);
    expect(v.payments).toHaveLength(2);
  });

  it('counts a payment below dust as underpaid; nothing is converted', async () => {
    const inv = await invoice();
    await pay(inv, BigInt(base.landing.dustSats) - 500n);
    const v = await view(inv.id);
    expect(v.status).toBe('underpaid');
    expect(v.convert).toEqual([]);
  });

  it('expires unpaid, and a payment after expiry is paid_late', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-11-16T12:00:00Z');
    vi.setSystemTime(t0);
    const inv = await invoice();
    vi.setSystemTime(t0.getTime() + base.pay.validMinutes * 60_000);
    expect((await view(inv.id)).status).toBe('expired');
    await pay(inv, BigInt(inv.requiredSats));
    expect((await view(inv.id)).status).toBe('paid_late');
  });
});
