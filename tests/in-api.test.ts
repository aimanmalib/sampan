// "Bring in" from another chain through the API on the fake network and the fake THORNode: paused while cross-chain
// is off; a quote to the user's own address; a plan whose memo pays either that address (BCH) or a landing address
// the page can recompute (the stablecoin), checked by the page's own rule; the source tx hash is recorded once.
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { livePatch } from '../core/route-assets.js';
import { checkInPlan } from '../core/evm/check-in.js';
import { acceptCard } from '../core/client/land.js';
import { allOff } from './helpers/cross-off.js';
import { buildApp } from '../server/app.js';
import { createServices } from '../server/services.js';
import { userAddress } from './helpers/wallet.js';

const base = allOff(normalizeConfig(shipped as unknown as SampanConfig));
const crossOn = patchConfig(base, JSON.stringify({ compliance: { crossChainEnabled: true }, ...livePatch(base.thorchain.assets, ['BASE']), rate: { quotesPerMinute: 1000, crossingsPerHour: 1000 } }));
const USDC = base.evm.chains.find((c) => c.key === 'BASE')!.tokens.USDC!.address;
let app: FastifyInstance | undefined;
let dist: string | undefined;

const start = async (c: SampanConfig) => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-in-'));
  const services = createServices({ config: c, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config: c, webDist: dist, fake: true, services, startWatcher: false });
};
afterEach(async () => {
  await app?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
  app = undefined;
});

const post = (url: string, payload: unknown) => app!.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
const ask = (receive: string, amount = '500000000') => ({ symbol: 'USDC', chain: 'BASE', amount, receive, address: userAddress });
const now = () => Math.floor(Date.now() / 1000);

describe('POST /api/in/*', () => {
  it('answers 503 route_paused while cross-chain crossings are switched off', async () => {
    await start(base);
    const res = await post('/api/in/quote', ask('BCH'));
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('route_paused');
  });

  it('quotes to the user address and refuses amounts outside the limits', async () => {
    await start(crossOn);
    const res = await post('/api/in/quote', ask('BCH'));
    expect(res.statusCode).toBe(200);
    const q = res.json().quote as { minSats: string; expectedSats: string; usd: number };
    expect(BigInt(q.minSats)).toBeLessThan(BigInt(q.expectedSats));
    expect(q.usd).toBe(5);
    expect((await post('/api/in/quote', ask('BCH', '10000000'))).json().error).toBe('below_route_min');
    expect((await post('/api/in/quote', ask('BCH', String(1e8 * (base.limits.maxUsd + 1))))).json().error).toBe('above_max');
    expect((await post('/api/in/quote', { ...ask('BCH'), receive: 'DOGE' })).statusCode).toBe(400);
  });

  it('plans BCH to the user address: the memo passes the page check, the hash is recorded once', async () => {
    await start(crossOn);
    const q = (await post('/api/in/quote', ask('BCH'))).json().quote as { minSats: string };
    const res = await post('/api/in/plan', { ...ask('BCH'), minSats: q.minSats });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { crossingId: string; deposit: { router: string; vault: string; token: string; amount: string; memo: string; expiry: number }; landing?: unknown };
    expect(body.landing).toBeUndefined();
    const d = { ...body.deposit, amount: BigInt(body.deposit.amount) };
    expect(checkInPlan(d, { token: USDC, amount: 500_000_000n, destination: userAddress, minSats: BigInt(q.minSats), now: now() })).toBe(true);
    const hash = `0x${'ab'.repeat(32)}`;
    expect((await post(`/api/in/${body.crossingId}/sent`, { txHash: hash })).statusCode).toBe(200);
    expect((await post(`/api/in/${body.crossingId}/sent`, { txHash: hash })).statusCode).toBe(409);
    const view = (await app!.inject({ method: 'GET', url: `/api/crossings/${body.crossingId}` })).json();
    expect(view).toMatchObject({ kind: 'in', asset: 'USDC', chain: 'BASE', status: 'completed', txid: 'AB'.repeat(32), landingId: null });
    expect(view.out.stage).toBe('done');
  });

  it('plans the stablecoin through a landing address the page recomputes', async () => {
    await start(crossOn);
    const q = (await post('/api/in/quote', ask('PUSD'))).json().quote as { minSats: string };
    const res = await post('/api/in/plan', { ...ask('PUSD'), minSats: q.minSats });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { crossingId: string; deposit: { memo: string; amount: string; router: string; vault: string; token: string; expiry: number }; landing: { crossingId: string; card: { address: string } } };
    const category = base.tokens.PUSD!.category;
    expect(() => acceptCard(body.landing.card, { ownerAddress: userAddress, token: 'PUSD', category, returnAfter: base.landing.returnAfterBlocks, prefix: 'bitcoincash' })).not.toThrow();
    const landingAddress = body.landing.card.address;
    const d = { ...body.deposit, amount: BigInt(body.deposit.amount) };
    expect(checkInPlan(d, { token: USDC, amount: 500_000_000n, destination: landingAddress, minSats: BigInt(q.minSats), now: now() })).toBe(true);
    expect(checkInPlan(d, { token: USDC, amount: 500_000_000n, destination: userAddress, minSats: BigInt(q.minSats), now: now() })).toMatch(/another address/);
    const view = (await app!.inject({ method: 'GET', url: `/api/crossings/${body.crossingId}` })).json();
    expect(view.landingId).toBe(body.landing.crossingId);
  });

  it('refuses a plan when the price moved past the minimum shown', async () => {
    await start(crossOn);
    const res = await post('/api/in/plan', { ...ask('BCH'), minSats: '99999999999' });
    expect(res.json().error).toBe('price_moved');
  });
});
