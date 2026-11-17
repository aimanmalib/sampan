// "Send out" through the API on the fake network and the fake THORNode: paused while cross-chain is off,
// quotes with limits, a BCH deposit checked by the page's own rule 6 expectation, signed, sent and followed.
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { checkTransaction } from '../core/check.js';
import { depositExpectation, type OutIntent, type WireOutQuote } from '../core/client/out.js';
import type { WalletView } from '../core/client/scan.js';
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { withLive } from '../core/route-assets.js';
import { thorAsset } from '../core/routes/memo.js';
import { signP2pkhInputs } from '../core/tx/sign.js';
import { encodeTransaction, binToHex } from '@bitauth/libauth';
import { outputFromWire, txFromHex } from '../core/wire.js';
import { buildApp } from '../server/app.js';
import type { FakeChain } from '../server/chain/fake.js';
import { createServices, type Services } from '../server/services.js';
import { PUSD, testKey } from './helpers/pools.js';
import { userAddress, userLockHex } from './helpers/wallet.js';

const base = normalizeConfig(shipped as unknown as SampanConfig);
const crossOn = patchConfig(base, JSON.stringify({ compliance: { crossChainEnabled: true }, thorchain: { assets: withLive(base.thorchain.assets, ['BASE']) }, rate: { quotesPerMinute: 1000, crossingsPerHour: 1000 } }));
const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const USDC = base.evm.chains.find((c) => c.key === 'BASE')!.tokens.USDC!.address;
let app: FastifyInstance | undefined;
let services: Services;
let dist: string | undefined;

const start = async (c: SampanConfig) => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-out-'));
  services = createServices({ config: c, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config: c, webDist: dist, fake: true, services, startWatcher: false });
  return app;
};
afterEach(async () => {
  await app?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
  app = undefined;
});

const post = (url: string, payload: unknown) => app!.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
const ask = { symbol: 'USDC', chain: 'BASE', destination: DEST };
const wallet = { derived: [{ path: 'receive', index: 0, address: userAddress, lockingHex: userLockHex }] } as unknown as WalletView;

describe('POST /api/out/*', () => {
  it('answers 503 route_paused while cross-chain crossings are switched off', async () => {
    await start(base);
    const res = await post('/api/out/quote', { source: 'BCH', amount: '1000000', ...ask });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('route_paused');
  });

  it('quotes BCH out with the route limit in the memo, and refuses amounts below the route minimum', async () => {
    await start(crossOn);
    const res = await post('/api/out/quote', { source: 'BCH', amount: '1000000', ...ask });
    expect(res.statusCode).toBe(200);
    const q = res.json().quote as WireOutQuote;
    expect(q.sats).toBe('1000000');
    expect(q.memo).toBe(`=:BASE.USDC:${DEST}:${q.minOut}`);
    expect(BigInt(q.minOut) < BigInt(q.expectedOut)).toBe(true);
    const small = await post('/api/out/quote', { source: 'BCH', amount: '100000', ...ask });
    expect(small.statusCode).toBe(400);
    expect(small.json().error).toBe('below_route_min');
    const bad = await post('/api/out/quote', { source: 'BCH', amount: '1000000', symbol: 'USDT', chain: 'BASE', destination: DEST });
    expect(bad.json().error).toBe('bad_request');
  });

  it('from the stablecoin, quotes step 1 (swap) and deposits less than the swap minimum', async () => {
    await start(crossOn);
    const res = await post('/api/out/quote', { source: 'PUSD', amount: '1000', ...ask });
    expect(res.statusCode).toBe(200);
    const q = res.json().quote as WireOutQuote;
    expect(q.swap?.side).toBe('sell');
    expect(BigInt(q.sats) < BigInt(q.swap!.minReceive)).toBe(true);
    const build = await post('/api/out/build', { source: 'PUSD', amount: '1000', ...ask, minOut: q.minOut, addresses: [{ address: userAddress, path: 'receive/0' }] });
    expect(build.json().error).toBe('bad_request');
  });

  it('builds a BCH deposit the page accepts, sends it and follows it to completed', async () => {
    await start(crossOn);
    (services.chain as FakeChain).add(userLockHex, { txid: 'cd'.repeat(32), vout: 0, sats: 2_000_000n, height: 1 });
    const q = (await post('/api/out/quote', { source: 'BCH', amount: '1000000', ...ask })).json().quote as WireOutQuote;
    const res = await post('/api/out/build', { source: 'BCH', amount: '1000000', ...ask, minOut: q.minOut, addresses: [{ address: userAddress, path: 'receive/0' }] });
    expect(res.statusCode).toBe(200);
    const build = res.json();
    const intent: OutIntent = {
      source: 'BCH',
      amount: 1_000_000n,
      symbol: 'USDC',
      chain: 'BASE',
      asset: thorAsset('BASE', 'USDC', USDC),
      destination: DEST,
      minOut: BigInt(q.minOut),
      category: PUSD,
      feeCapSats: BigInt(base.fees.capSats),
      business: base.business,
      prompts: { swap: '', deposit: '' },
    };
    const tx = txFromHex(build.tx);
    const src = build.sourceOutputs.map(outputFromWire);
    expect(checkTransaction(tx, src, depositExpectation(build, wallet, intent))).toEqual({ ok: true });
    expect(() => depositExpectation(build, wallet, { ...intent, destination: `0x${'b'.repeat(40)}` })).toThrow(/another address/);
    expect(() => depositExpectation(build, wallet, { ...intent, amount: 999_999n })).toThrow(/amount shown/);

    const signed = binToHex(encodeTransaction(signP2pkhInputs(tx, src, [0], testKey)));
    const sent = await post('/api/broadcast', { crossingId: build.crossingId, tx: signed });
    expect(sent.statusCode).toBe(200);
    const status = (await app!.inject({ method: 'GET', url: `/api/crossings/${build.crossingId}` })).json();
    expect(status).toMatchObject({ kind: 'out', route: 'thorchain', status: 'completed', out: { stage: 'done', outChain: 'BASE' } });
    expect(JSON.stringify(status)).not.toContain(DEST);
  });

  it('refuses to build when the fresh minimum is below the one shown', async () => {
    await start(crossOn);
    (services.chain as FakeChain).add(userLockHex, { txid: 'cd'.repeat(32), vout: 0, sats: 2_000_000n, height: 1 });
    const q = (await post('/api/out/quote', { source: 'BCH', amount: '1000000', ...ask })).json().quote as WireOutQuote;
    const res = await post('/api/out/build', { source: 'BCH', amount: '1000000', ...ask, minOut: (BigInt(q.minOut) + 1n).toString(), addresses: [{ address: userAddress, path: 'receive/0' }] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('price_moved');
  });

  it('step 2 deposits the BCH that step 1 paid, as input 0', async () => {
    await start(crossOn);
    const step1 = 'ef'.repeat(32);
    (services.chain as FakeChain).add(userLockHex, { txid: 'cd'.repeat(32), vout: 0, sats: 9_000_000n, height: 1 });
    const q = (await post('/api/out/quote', { source: 'PUSD', amount: '1000', ...ask })).json().quote as WireOutQuote;
    // Step 1 pays at least its minimum less its fee (at most the cap); that is enough for the quoted deposit.
    const paid = BigInt(q.swap!.minReceive) - BigInt(base.fees.capSats);
    (services.chain as FakeChain).add(userLockHex, { txid: step1, vout: 3, sats: paid, height: 0 });
    const res = await post('/api/out/build', { source: 'PUSD', amount: '1000', ...ask, minOut: q.minOut, addresses: [{ address: userAddress, path: 'receive/0' }], fromTxid: step1 });
    expect(res.statusCode).toBe(200);
    const tx = txFromHex(res.json().tx);
    expect(tx.inputs).toHaveLength(1);
    expect(binToHex(tx.inputs[0]!.outpointTransactionHash)).toBe(step1);
    expect(tx.outputs).toHaveLength(3);
  });
});
