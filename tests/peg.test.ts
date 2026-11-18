// Pool depth and the PUSD peg guard: the arithmetic (core/peg.ts), the reader (only verified pools count, a dead
// indexer is an error and never zero, a dead THORNode is "unknown" and refuses nothing), GET /api/depth on the fake
// network, and peg_off on new crossings and landing addresses while swaps stay open.
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { normalizeConfig, patchConfig, publicConfig, validateConfig, type SampanConfig } from '../core/config.js';
import { midPriceE8, onePercentSats, pegBpsOf, pegLevelOf, validatePeg } from '../core/peg.js';
import type { PoolUtxo } from '../core/pools/trade.js';
import { livePatch } from '../core/route-assets.js';
import { buildApp } from '../server/app.js';
import { ChainUnavailableError } from '../server/chain/types.js';
import { DepthReader } from '../server/depth.js';
import { PoolDirectory, type IndexerPool } from '../server/indexer.js';
import { FakeChain } from '../server/chain/fake.js';
import { poolV0LockingHex } from '../core/pools/template.js';
import { createServices, type Services } from '../server/services.js';
import { allOff } from './helpers/cross-off.js';
import { userAddress } from './helpers/wallet.js';

const PEG = { warnBps: 100, refuseBps: 200 };
const CAT = 'aa'.repeat(32);
const pool = (sats: bigint, tokens: bigint, n = 1): PoolUtxo => ({ txid: n.toString(16).padStart(64, '0'), vout: 0, sats, tokens, category: CAT, ownerPkh: '11'.repeat(20) });
/** 500 BCH against 250,000.00 PUSD (2 decimals): mid = 500 PUSD per BCH. */
const POOLS = [pool(40_000_000_000n, 20_000_000n, 1), pool(10_000_000_000n, 5_000_000n, 2)];
const MID = 500_00000000n;
const reader = (o: { pools?: () => Promise<PoolUtxo[]>; bchUsd?: () => Promise<bigint | null>; now?: () => number } = {}) =>
  new DepthReader({
    peg: PEG,
    pools: o.pools ?? (async () => POOLS),
    bchUsd: o.bchUsd ?? (async () => MID),
    symbol: 'PUSD',
    decimals: 2,
    cacheSeconds: 5,
    sources: { pools: 'https://indexer.example/cauldron/pool/active?token=x', price: 'https://node.example/thorchain/pool/BCH.BCH' },
    ...(o.now ? { now: o.now } : {}),
  });
/** BCH dollar price that puts PUSD `bps` basis points from one dollar. */
const priceAt = (bps: bigint): bigint => (MID * (10000n + bps)) / 10000n;

describe('core/peg', () => {
  it('takes the mid price of all pools together and the 1% depth from their BCH', () => {
    expect(midPriceE8(50_000_000_000n, 25_000_000n, 2)).toBe(MID);
    expect(onePercentSats(50_000_000_000n)).toBe(505_050_505n);
  });

  it('measures PUSD against one dollar in basis points, both ways, rounded', () => {
    expect(pegBpsOf(MID, MID)).toBe(0);
    expect(pegBpsOf(MID, priceAt(150n))).toBe(150);
    expect(pegBpsOf(MID, priceAt(-250n))).toBe(-250);
    expect(pegBpsOf(10000n, 10001n)).toBe(1);
    expect(pegBpsOf(20000n, 20001n)).toBe(1); // 0.5 bps rounds away from zero
    expect(pegBpsOf(20000n, 19999n)).toBe(-1);
  });

  it('warns at warnBps, refuses at refuseBps, and an unknown peg is unknown', () => {
    expect(pegLevelOf(99, PEG)).toBe('ok');
    expect(pegLevelOf(100, PEG)).toBe('warn');
    expect(pegLevelOf(-150, PEG)).toBe('warn');
    expect(pegLevelOf(199, PEG)).toBe('warn');
    expect(pegLevelOf(200, PEG)).toBe('refuse');
    expect(pegLevelOf(-250, PEG)).toBe('refuse');
    expect(pegLevelOf(null, PEG)).toBe('unknown');
  });

  it('validates peg in the shipped config and refuses thresholds out of order or range', () => {
    const c = shipped as unknown as SampanConfig;
    expect(validateConfig(c)).toEqual([]);
    expect(c.peg).toEqual({ warnBps: 100, refuseBps: 200 });
    expect(publicConfig(c).peg).toEqual(c.peg);
    expect(validatePeg({ warnBps: 200, refuseBps: 200 })).toEqual(['peg: warnBps must be below refuseBps']);
    expect(validatePeg({ warnBps: 0, refuseBps: 200 })).toHaveLength(1);
    expect(validatePeg({ warnBps: 100, refuseBps: 10000 })).toHaveLength(1);
    expect(validatePeg(undefined)).toHaveLength(1);
    expect(validateConfig({ ...c, peg: { warnBps: 300, refuseBps: 200 } })).toContain('peg: warnBps must be below refuseBps');
  });
});

describe('DepthReader', () => {
  it('reads pools, mid price, 1% depth and the peg, and reuses a reading for cacheSeconds', async () => {
    let t = 1_000;
    let asks = 0;
    const r = reader({ now: () => t, pools: async () => (asks++, POOLS) });
    const d = await r.read();
    expect(d).toMatchObject({ pools: 2, bch: '50000000000', token: '25000000', midPriceE8: MID.toString(), onePercentBch: '505050505', bchUsdE8: MID.toString(), pegBps: 0, peg: 'ok', read: 1_000 });
    t += 4_999;
    await r.read();
    expect(asks).toBe(1);
    t += 1;
    await r.read();
    expect(asks).toBe(2);
  });

  it('warns at 150 bps and refuses at 250 bps', async () => {
    expect(await reader({ bchUsd: async () => priceAt(150n) }).level()).toBe('warn');
    expect(await reader({ bchUsd: async () => priceAt(-250n) }).level()).toBe('refuse');
  });

  it('keeps the numbers but calls the peg unknown when THORNode does not answer', async () => {
    for (const bchUsd of [async () => null, async () => Promise.reject(new Error('node answered 502'))]) {
      const d = await reader({ bchUsd }).read();
      expect(d).toMatchObject({ pools: 2, bchUsdE8: null, pegBps: null, peg: 'unknown' });
    }
  });

  it('fails (never zero) when the indexer or the BCH servers are down, or no pool is left; the guard sees unknown', async () => {
    for (const pools of [
      async () => Promise.reject(new Error('no Cauldron indexer answered: 502')),
      async () => Promise.reject(new ChainUnavailableError('down')),
      async () => [],
    ]) {
      await expect(reader({ pools }).read()).rejects.toThrow();
      expect(await reader({ pools }).level()).toBe('unknown');
    }
  });

  it('counts only pools whose lock the chain confirms (an indexer-only pool adds nothing)', async () => {
    const chain = new FakeChain();
    const real: IndexerPool = { owner_pkh: '22'.repeat(20), sats: 40_000_000_000, tokens: 20_000_000, tx_pos: 0, txid: '01'.repeat(32) };
    const forged: IndexerPool = { owner_pkh: '33'.repeat(20), sats: 9_000_000_000_000, tokens: 1, tx_pos: 0, txid: '02'.repeat(32) };
    chain.add(poolV0LockingHex(real.owner_pkh), { txid: real.txid, vout: 0, sats: 40_000_000_000n, height: 1, token: { category: CAT, amount: 20_000_000n } });
    const dir = new PoolDirectory({ indexers: ['https://indexer.example'], cacheSeconds: 5, fetchActive: async () => [real, forged], chain });
    const d = await reader({ pools: () => dir.active(CAT) }).read();
    expect(d).toMatchObject({ pools: 1, bch: '40000000000', token: '20000000', peg: 'ok' });
  });
});

describe('GET /api/depth and peg_off', () => {
  const base = allOff(normalizeConfig(shipped as unknown as SampanConfig));
  const on = patchConfig(
    base,
    JSON.stringify({
      compliance: { crossChainEnabled: true },
      features: { landing: true },
      ...livePatch(base.thorchain.assets, ['BASE']),
      rate: { quotesPerMinute: 1000, crossingsPerHour: 1000 },
    }),
  );
  let app: FastifyInstance | undefined;
  let services: Services;
  let dist: string | undefined;
  const start = async (c: SampanConfig, outage?: 'indexer') => {
    dist = mkdtempSync(path.join(tmpdir(), 'sampan-peg-'));
    services = createServices({ config: c, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json'), outage: outage ?? null });
    app = await buildApp({ config: c, webDist: dist, fake: true, services, startWatcher: false });
  };
  afterEach(async () => {
    await app?.close();
    if (dist) rmSync(dist, { recursive: true, force: true });
    app = undefined;
  });
  const priced = (price: bigint): void => {
    services.depth = new DepthReader({ peg: on.peg, pools: () => services.pools.active(on.tokens.PUSD!.category), bchUsd: async () => price, symbol: 'PUSD', decimals: 2, cacheSeconds: 5, sources: { pools: 'x', price: 'y' } });
  };
  const post = (url: string, payload: unknown) => app!.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
  const outBuild = { source: 'BCH', amount: '1000000', symbol: 'USDC', chain: 'BASE', destination: '0x1a877169bB03400fA69EC4813889E78994D194Cb', minOut: '1', addresses: [{ address: userAddress, path: 'receive/0' }] };
  const inPlan = { symbol: 'USDC', chain: 'BASE', amount: '500000000', receive: 'BCH', address: userAddress, minSats: '1' };
  const landOpen = { ownerAddress: userAddress, token: 'PUSD' };

  it('answers the fake network depth with its sources, peg ok', async () => {
    await start(on);
    const res = await app!.inject({ method: 'GET', url: '/api/depth' });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d).toMatchObject({ pools: 13, symbol: 'PUSD', decimals: 2, peg: 'ok' });
    expect(Math.abs(d.pegBps)).toBeLessThan(on.peg.warnBps);
    expect(d.sources.pools).toBe(`${on.cauldron.indexers[0]}/cauldron/pool/active?token=${on.tokens.PUSD!.category}`);
    expect(d.sources.price).toBe(`${on.thorchain.nodes[0]}/thorchain/pool/BCH.BCH`);
  });

  it('answers 503 with a message, not zeros, while the indexer is down', async () => {
    await start(on, 'indexer');
    const res = await app!.inject({ method: 'GET', url: '/api/depth' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'pools_unavailable' });
    expect(res.json().bch).toBeUndefined();
  });

  it('refuses new crossings and landing addresses with peg_off at 250 bps; swaps still quote', async () => {
    await start(on);
    const mid = BigInt((await app!.inject({ method: 'GET', url: '/api/depth' })).json().midPriceE8);
    priced((mid * 9750n) / 10000n);
    for (const [url, body] of [['/api/out/build', outBuild], ['/api/in/plan', inPlan], ['/api/land/open', landOpen]] as const) {
      const res = await post(url, body);
      expect(res.statusCode, url).toBe(503);
      expect(res.json().error, url).toBe('peg_off');
    }
    const swap = await post('/api/swap/quote', { side: 'buy', token: 'PUSD', amount: '1000000' });
    expect(swap.statusCode).toBe(200);
  });

  it('lets them through at 150 bps (warning only) and while the peg is unknown', async () => {
    await start(on);
    const mid = BigInt((await app!.inject({ method: 'GET', url: '/api/depth' })).json().midPriceE8);
    for (const price of [(mid * 10150n) / 10000n, 0n]) {
      priced(price);
      const res = await post('/api/land/open', landOpen);
      expect(res.statusCode).toBe(200);
    }
  });
});
