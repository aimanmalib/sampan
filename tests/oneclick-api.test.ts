// The 1Click route through Sampan's own endpoints (route: 'near-intents') on the fake network and the fake 1Click
// built from the synthetic fixture: not offered while features.oneClick is off; out builds the two-output deposit
// rule 6 accepts, is sent and followed by deposit address; in plans one plain transfer and needs the connected wallet
// address for refunds. The API key never leaves the server.
import { binToHex, encodeTransaction } from '@bitauth/libauth';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { checkTransaction } from '../core/check.js';
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { signP2pkhInputs } from '../core/tx/sign.js';
import { outputFromWire, txFromHex } from '../core/wire.js';
import { buildApp } from '../server/app.js';
import type { FakeChain } from '../server/chain/fake.js';
import { createServices, type Services } from '../server/services.js';
import { testKey } from './helpers/pools.js';
import { userAddress, userLockHex } from './helpers/wallet.js';

const base = normalizeConfig(shipped as unknown as SampanConfig);
const live = base.oneClick.assets.map((a) => ({ ...a, live: { out: true, in: true } }));
const rate = { quotesPerMinute: 1000, crossingsPerHour: 1000 };
const crossOn = patchConfig(base, JSON.stringify({ compliance: { crossChainEnabled: true }, rate }));
const oneClickOn = patchConfig(base, JSON.stringify({ compliance: { crossChainEnabled: true }, rate, features: { oneClick: true }, oneClick: { assets: live } }));
const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
// Made up for the test; shaped like a JWT so a leak would be easy to spot.
const KEY = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJzYW1wYW4tdGVzdCJ9', 'c2lnbmF0dXJl'].join('.');
let app: FastifyInstance | undefined;
let services: Services;
let dist: string | undefined;

const start = async (c: SampanConfig) => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-oc-'));
  services = createServices({ config: c, fake: true, dbFile: ':memory:', trustedProxies: [], oneClickKey: KEY, fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config: c, webDist: dist, fake: true, services, startWatcher: false });
};
afterEach(async () => {
  await app?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
  app = undefined;
});

const post = (url: string, payload: unknown) => app!.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
const out = { source: 'BCH', amount: '1000000', symbol: 'USDC', chain: 'ETH', destination: DEST, route: 'near-intents' };
const into = { symbol: 'USDC', chain: 'ETH', amount: '200000000', receive: 'BCH', address: userAddress, route: 'near-intents' };

describe('1Click through /api/out and /api/in', () => {
  it('is not offered while features.oneClick is off; THORChain requests are unchanged', async () => {
    await start(crossOn);
    expect(services.routes.map((r) => r.id)).toEqual(['thorchain']);
    const res = await post('/api/out/quote', out);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/route is not offered/);
    expect((await post('/api/in/quote', into)).statusCode).toBe(400);
    expect((await post('/api/out/quote', { ...out, route: 'other' })).statusCode).toBe(400);
  });

  it('quotes out dry, builds the two-output deposit, sends it, tells 1Click and follows it to completed', async () => {
    await start(oneClickOn);
    (services.chain as FakeChain).add(userLockHex, { txid: 'cd'.repeat(32), vout: 0, sats: 2_000_000n, height: 1 });
    const q = (await post('/api/out/quote', out)).json().quote as { memo: string; minOut: string; route: string; outDecimals: number };
    expect(q).toMatchObject({ route: 'near-intents', memo: '', outDecimals: 6 });
    const res = await post('/api/out/build', { ...out, minOut: q.minOut, addresses: [{ address: userAddress, path: 'receive/0' }] });
    expect(res.statusCode).toBe(200);
    const build = res.json();
    expect(build.deposit.opReturn).toBe('');
    const tx = txFromHex(build.tx);
    const src = build.sourceOutputs.map(outputFromWire);
    expect(tx.outputs).toHaveLength(2);
    const e = {
      userLockingBytecodes: [userLockHex],
      inputPaths: build.inputPaths,
      poolOwnerPkhs: [],
      deposits: [{ lockingBytecode: build.deposit.lockingBytecode, sats: BigInt(build.deposit.sats) }],
      oneClickDeposit: true,
      spend: { sats: 1_000_000n, tokens: {} },
      feeCapSats: BigInt(base.fees.capSats),
    };
    expect(checkTransaction(tx, src, e)).toEqual({ ok: true });
    const signed = binToHex(encodeTransaction(signP2pkhInputs(tx, src, [0], testKey)));
    expect((await post('/api/broadcast', { crossingId: build.crossingId, tx: signed })).statusCode).toBe(200);
    const status = (await app!.inject({ method: 'GET', url: `/api/crossings/${build.crossingId}` })).json();
    expect(status).toMatchObject({ kind: 'out', route: 'near-intents', status: 'completed', out: { stage: 'done' } });
    expect(services.db.getCrossing(build.crossingId)?.error).toBeNull();
  });

  it('plans in as one plain transfer, only with the connected wallet address for refunds', async () => {
    await start(oneClickOn);
    const q = await post('/api/in/quote', into);
    expect(q.statusCode).toBe(200);
    expect(q.json().quote).toMatchObject({ route: 'near-intents', router: '' });
    const minSats = q.json().quote.minSats as string;
    const noFrom = await post('/api/in/plan', { ...into, minSats });
    expect(noFrom.statusCode).toBe(422);
    expect(noFrom.json().error).toBe('placeholder_address');
    const placeholder = await post('/api/in/plan', { ...into, minSats, from: base.oneClick.placeholders.evm });
    expect(placeholder.statusCode).toBe(422);
    const plan = await post('/api/in/plan', { ...into, minSats, from: DEST });
    expect(plan.statusCode).toBe(200);
    expect(plan.json().deposit).toMatchObject({ kind: 'transfer', vault: '0x' + '5a'.repeat(20), amount: '2000000' });
    const hash = `0x${'AB'.repeat(32)}`;
    expect((await post(`/api/in/${plan.json().crossingId}/sent`, { txHash: hash })).statusCode).toBe(200);
    const status = (await app!.inject({ method: 'GET', url: `/api/crossings/${plan.json().crossingId}` })).json();
    expect(status).toMatchObject({ kind: 'in', route: 'near-intents', txid: hash.toLowerCase(), status: 'completed', out: { stage: 'done' } });
  });

  it('never sends the API key to the page', async () => {
    await start(oneClickOn);
    const answers = await Promise.all([
      app!.inject({ method: 'GET', url: '/api/config' }),
      post('/api/out/quote', out),
      post('/api/out/quote', { ...out, amount: '1' }),
      post('/api/in/plan', { ...into, minSats: '1' }),
    ]);
    for (const a of answers) expect(a.body).not.toContain(KEY);
    expect(answers[0]!.json().features.oneClick).toBe(true);
    expect(answers[0]!.body).not.toMatch(/chaindefuser|x-api-key/i);
  });
});
