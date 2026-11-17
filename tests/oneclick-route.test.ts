// The 1Click route (server/routes/oneclick.ts) and its API client against the fake built from the synthetic fixture:
// the API key travels in X-API-Key only, dry quotes go to placeholder addresses and stay in memory for cacheSeconds,
// a real quote to a placeholder is refused, and the BCH deposit has exactly the two outputs rule 6 allows.
import { hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { checkTransaction } from '../core/check.js';
import { normalizeConfig, validateConfig, type SampanConfig } from '../core/config.js';
import { fakeOneClick, type FakeOneClickLog } from '../server/routes/fake-oneclick.js';
import { OneClickApi, OneClickError, type OneClickHttp } from '../server/routes/oneclick-api.js';
import { OneClickRoute } from '../server/routes/oneclick.js';
import { RouteError } from '../server/routes/types.js';
import { userAddress, userLockHex } from './helpers/wallet.js';

const config = normalizeConfig(shipped as unknown as SampanConfig);
const oc = config.oneClick;
const USDC = oc.assets[0]!.id;
const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
// Made up for the test; shaped like a JWT so a leak would be easy to spot.
const KEY = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJzYW1wYW4tdGVzdCJ9', 'c2lnbmF0dXJl'].join('.');

const setup = (o: { key?: string; now?: () => number; http?: OneClickHttp } = {}) => {
  const log: FakeOneClickLog = { requests: [] };
  const decimalsOf = (id: string): number => oc.assets.find((a) => a.id === id)?.decimals ?? 0;
  const api = new OneClickApi({
    baseUrl: oc.baseUrl,
    userAgent: oc.userAgent,
    timeoutMs: oc.timeoutMs,
    cacheSeconds: oc.cacheSeconds,
    apiKey: o.key,
    http: o.http ?? fakeOneClick(oc.bchAsset, decimalsOf, undefined, log),
    ...(o.now ? { now: o.now } : {}),
  });
  const route = new OneClickRoute({ api, config: oc, minSatsPerByte: 1n, ...(o.now ? { now: o.now } : {}) });
  return { api, route, log };
};

const coin = { txid: 'ab'.repeat(32), vout: 0, sats: 3_000_000n, lockingHex: userLockHex, path: 'receive/0', hasToken: false };

describe('oneClick config', () => {
  it('ships switched off, with no Sampan fee, a cache within 24 hours and the THORChain route still active', () => {
    expect(validateConfig(config)).toEqual([]);
    expect(config.features.oneClick).toBe(false);
    expect(config.route.active).toBe('thorchain');
    expect(oc.appFeeBps).toBe(0);
    expect(oc.assets.every((a) => !a.live.out && !a.live.in)).toBe(true);
  });

  it('refuses a cache over 24 hours, an app fee and an asset with other decimals than its chain', () => {
    const bad = { ...config, oneClick: { ...oc, cacheSeconds: 86_401, appFeeBps: 10, assets: [{ ...oc.assets[0]!, decimals: 18 }] } };
    const errors = validateConfig(bad).join('\n');
    expect(errors).toMatch(/cacheSeconds/);
    expect(errors).toMatch(/appFeeBps/);
    expect(errors).toMatch(/decimals must equal/);
  });
});

describe('OneClickApi', () => {
  it('sends the key as X-API-Key and the configured user agent, and no key header without one', async () => {
    const withKey = setup({ key: KEY });
    await withKey.route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST });
    const sent = withKey.log.requests[0]!;
    expect(sent.headers['x-api-key']).toBe(KEY);
    expect(sent.headers['user-agent']).toBe(oc.userAgent);
    expect(sent.url).not.toContain(KEY);
    const without = setup();
    await without.route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST });
    expect(Object.keys(without.log.requests[0]!.headers).map((h) => h.toLowerCase())).not.toContain('x-api-key');
  });

  it('never puts the key in an error, whether the API refuses it or the connection fails', async () => {
    const refused = setup({ key: KEY, http: async (r) => ({ status: 401, body: { message: `bad key ${r.headers['x-api-key']}` } }) });
    const e1 = await refused.api.status('x').catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(OneClickError);
    expect(String((e1 as Error).message)).not.toContain(KEY);
    const broken = setup({ key: KEY, http: async (r) => Promise.reject(new Error(`socket closed ${JSON.stringify(r.headers)}`)) });
    const e2 = await broken.api.status('x').catch((e: unknown) => e);
    expect(String((e2 as Error).message)).not.toContain(KEY);
    const e3 = await broken.route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST }).catch((e: unknown) => e);
    expect(e3).toBeInstanceOf(RouteError);
    expect(JSON.stringify({ m: (e3 as Error).message, s: (e3 as Error).stack })).not.toContain(KEY);
  });

  it('keeps a dry quote for cacheSeconds, then asks again; a real quote is never kept', async () => {
    let t = 1_800_000_000_000;
    const { route, log } = setup({ now: () => t });
    await route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST });
    t += (oc.cacheSeconds - 1) * 1000;
    await route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST });
    expect(log.requests).toHaveLength(1);
    t += 2000;
    await route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST });
    expect(log.requests).toHaveLength(2);
    await route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST, refundTo: userAddress });
    await route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST, refundTo: userAddress });
    expect(log.requests).toHaveLength(4);
  });
});

describe('OneClickRoute out', () => {
  it('quotes dry to placeholder refund address while typing; that quote cannot be paid', async () => {
    const { route, log } = setup();
    const q = await route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST });
    const body = log.requests[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ dry: true, swapType: 'EXACT_INPUT', originAsset: oc.bchAsset, destinationAsset: USDC, amount: '1000000', refundTo: oc.placeholders.bch, recipient: DEST, slippageTolerance: oc.slippageBps });
    expect(body).not.toHaveProperty('appFees');
    expect(q).toMatchObject({ route: 'near-intents', memo: '', outDecimals: 6, vault: oc.placeholders.bch });
    expect(q.minOut < q.expectedOut).toBe(true);
    expect(q.fees.total).toBe(300_000n);
    expect(() => route.buildOut(q, [coin])).toThrow(expect.objectContaining({ code: 'placeholder_address' }));
  });

  it('refuses a real quote whose refund or recipient address is a placeholder', async () => {
    const { route, log } = setup();
    await expect(route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST, refundTo: oc.placeholders.bch })).rejects.toMatchObject({ code: 'placeholder_address' });
    await expect(route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: oc.placeholders.evm, refundTo: userAddress })).rejects.toMatchObject({ code: 'placeholder_address' });
    expect(log.requests).toHaveLength(0);
  });

  it('builds the deposit as two outputs (deposit address, change to input 0) that rule 6 accepts; a third output is refused', async () => {
    const { route, log } = setup();
    const q = await route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST, refundTo: userAddress });
    expect((log.requests[0]!.body as { dry: boolean; refundTo: string }).dry).toBe(false);
    expect((log.requests[0]!.body as { refundTo: string }).refundTo).toBe(userAddress);
    expect(q.vault).not.toBe(oc.placeholders.bch);
    const p = route.buildOut(q, [coin]);
    expect(p.transaction.outputs).toHaveLength(2);
    const depositLock = '76a914' + '5a'.repeat(20) + '88ac';
    const e = {
      userLockingBytecodes: [userLockHex],
      inputPaths: p.inputPaths,
      poolOwnerPkhs: [],
      deposits: [{ lockingBytecode: depositLock, sats: 1_000_000n }],
      oneClickDeposit: true,
      spend: { sats: 1_000_000n, tokens: {} },
      feeCapSats: 5000n,
    };
    expect(checkTransaction(p.transaction, p.sourceOutputs, e)).toEqual({ ok: true });
    const third = { ...p.transaction, outputs: [...p.transaction.outputs, { lockingBytecode: hexToBin(userLockHex), valueSatoshis: 1000n }] };
    expect(checkTransaction(third, p.sourceOutputs, e)).toMatchObject({ ok: false, rule: 6 });
    // The THORChain shape (three outputs, memo) does not accept a 1Click deposit either.
    expect(checkTransaction(p.transaction, p.sourceOutputs, { ...e, oneClickDeposit: false, thorDeposit: true, opReturn: '6a00' })).toMatchObject({ ok: false, rule: 6 });
  });

  it('refuses a quote that asks for a memo or quotes another input amount', async () => {
    const memo: OneClickHttp = async (r) => {
      const q = JSON.parse(r.body!) as { amount: string };
      return { status: 201, body: { quote: { depositMemo: '1234', amountIn: q.amount, amountOut: '10', minAmountOut: '9', timeEstimate: 1 } } };
    };
    await expect(setup({ http: memo }).route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST })).rejects.toMatchObject({ code: 'route_unavailable' });
    const other: OneClickHttp = async () => ({ status: 201, body: { quote: { amountIn: '1', amountOut: '10', minAmountOut: '9', timeEstimate: 1 } } });
    await expect(setup({ http: other }).route.quoteOut({ sats: 1_000_000n, asset: USDC, destination: DEST })).rejects.toThrow(/different input amount/);
  });
  it('says the route minimum is not met when 1Click refuses a small amount, and bad_request for other refusals', async () => {
    const low: OneClickHttp = async () => ({ status: 400, body: { message: 'Amount is too low for bridge, try at least 1000000' } });
    await expect(setup({ http: low }).route.quoteOut({ sats: 1_000n, asset: USDC, destination: DEST })).rejects.toMatchObject({ code: 'below_route_min' });
    const other: OneClickHttp = async () => ({ status: 400, body: { message: 'tokenIn is not valid' } });
    await expect(setup({ http: other }).route.quoteOut({ sats: 1_000n, asset: USDC, destination: DEST })).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('OneClickRoute in and status', () => {
  it('converts the page amount (1e8) to token units and plans one plain transfer', async () => {
    const { route, log } = setup();
    const q = await route.quoteIn({ asset: USDC, amount: 200_000_000n, destination: userAddress, refundTo: DEST });
    expect(log.requests[0]!.body).toMatchObject({ dry: false, originAsset: USDC, destinationAsset: oc.bchAsset, amount: '2000000', recipient: userAddress, refundTo: DEST });
    expect(route.buildIn(q)).toEqual({ kind: 'transfer', vault: '0x' + '5a'.repeat(20), asset: USDC, amount: 2_000_000n, expiry: q.expiry });
    const dry = await route.quoteIn({ asset: USDC, amount: 200_000_000n, destination: userAddress });
    expect(() => route.buildIn(dry)).toThrow(expect.objectContaining({ code: 'placeholder_address' }));
  });

  it('asks status by deposit address and maps the API states', async () => {
    const { route } = setup();
    expect(await route.status('ff'.repeat(32), 'bitcoincash:qpd95kj6tfd95kj6tfd95kj6tfd95kj6tgcnendkh2')).toEqual({ stage: 'done', outTxid: '0x' + '11'.repeat(32) });
    await expect(route.status('ff'.repeat(32))).rejects.toMatchObject({ code: 'bad_request' });
    await expect(route.status('ff'.repeat(32), 'unknown')).rejects.toMatchObject({ code: 'route_unavailable' });
    for (const [status, stage] of [['PENDING_DEPOSIT', 'unseen'], ['PROCESSING', 'pending'], ['REFUNDED', 'refunded'], ['FAILED', 'failed']] as const) {
      const http: OneClickHttp = async () => ({ status: 200, body: { status, swapDetails: {} } });
      expect((await setup({ http }).route.status('x', 'y')).stage).toBe(stage);
    }
  });
});
