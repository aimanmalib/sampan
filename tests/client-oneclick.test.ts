// The page's own checks on the 1Click route (ADR 0050), against the fake server with the synthetic 1Click: Send out
// builds a two-output deposit that rule 6 accepts only when the quote names the typed address and at least the minimum
// shown; Bring in sends one plain transfer (no approval) and refuses a plan whose quote pays elsewhere. No network.
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeFunctionData } from 'viem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { checkTransaction } from '../core/check.js';
import { makeApi, type Api, type Fetch } from '../core/client/api.js';
import { InStop, runIn, type InIntent, type InStep } from '../core/client/in.js';
import { depositExpectation, type OutIntent, type WireOutQuote } from '../core/client/out.js';
import type { WalletView } from '../core/client/scan.js';
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { ERC20_ABI } from '../core/evm/calldata.js';
import { outputFromWire, txFromHex } from '../core/wire.js';
import { buildApp } from '../server/app.js';
import type { FakeChain } from '../server/chain/fake.js';
import { createServices, type Services } from '../server/services.js';
import synthetic from './fixtures/oneclick/synthetic.json' with { type: 'json' };
import { fakeEip1193 } from './helpers/fake-eip1193.js';
import { PUSD } from './helpers/pools.js';
import { userAddress, userLockHex } from './helpers/wallet.js';

const base = normalizeConfig(shipped as unknown as SampanConfig);
const eth = base.oneClick.assets.find((a) => a.chain === 'ETH' && a.symbol === 'USDC')!;
const config = patchConfig(
  base,
  JSON.stringify({
    features: { oneClick: true },
    compliance: { crossChainEnabled: true },
    oneClick: { assets: [{ ...eth, live: { out: true, in: true } }] },
    rate: { quotesPerMinute: 1000, crossingsPerHour: 1000 },
  }),
);
const chain = config.evm.chains.find((c) => c.key === 'ETH')!;
const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
let app: FastifyInstance;
let services: Services;
let dist: string;
let api: Api;

const injectFetch: Fetch = async (url, init) => {
  const res = await app.inject({
    method: (init?.method ?? 'GET') as 'GET' | 'POST',
    url,
    ...(init?.body ? { payload: init.body, headers: { 'content-type': 'application/json' } } : {}),
  });
  return { ok: res.statusCode < 400, status: res.statusCode, json: async () => res.json() };
};

beforeEach(async () => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-client-oc-'));
  services = createServices({ config, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config, webDist: dist, fake: true, services, startWatcher: false });
  api = makeApi(injectFetch);
});
afterEach(async () => {
  await app.close();
  rmSync(dist, { recursive: true, force: true });
});

describe('Send out on 1Click, checked in the page', () => {
  const wallet = { derived: [{ path: 'receive', index: 0, address: userAddress, lockingHex: userLockHex }] } as unknown as WalletView;
  const ask = { source: 'BCH', amount: '1000000', symbol: 'USDC', chain: 'ETH', destination: DEST, route: 'near-intents' };

  async function built(): Promise<{ build: Parameters<typeof depositExpectation>[0]; intent: OutIntent }> {
    (services.chain as FakeChain).add(userLockHex, { txid: 'cd'.repeat(32), vout: 0, sats: 2_000_000n, height: 1 });
    const q = (await api.post<{ quote: WireOutQuote }>('/api/out/quote', ask)).quote;
    expect(q).toMatchObject({ route: 'near-intents', memo: '' });
    const build = await api.post<Parameters<typeof depositExpectation>[0]>('/api/out/build', { ...ask, minOut: q.minOut, addresses: [{ address: userAddress, path: 'receive/0' }] });
    const intent: OutIntent = {
      source: 'BCH',
      amount: 1_000_000n,
      symbol: 'USDC',
      chain: 'ETH',
      asset: eth.id,
      destination: DEST,
      minOut: BigInt(q.minOut),
      category: PUSD,
      feeCapSats: BigInt(base.fees.capSats),
      business: base.business,
      route: 'near-intents',
      prompts: { swap: '', deposit: '' },
    };
    return { build, intent };
  }

  it('accepts the two-output deposit to the quoted deposit address', async () => {
    const { build, intent } = await built();
    expect(build.deposit.opReturn).toBe('');
    const tx = txFromHex(build.tx);
    expect(tx.outputs).toHaveLength(2);
    expect(checkTransaction(tx, build.sourceOutputs.map(outputFromWire), depositExpectation(build, wallet, intent))).toEqual({ ok: true });
  });

  it('refuses a quote for another address, a lower minimum, a memo, or an answer for the other route', async () => {
    const { build, intent } = await built();
    const alter = (f: (b: typeof build) => void) => {
      const copy = structuredClone(build);
      f(copy);
      return () => depositExpectation(copy, wallet, intent);
    };
    expect(alter((b) => (b.quote.destination = `0x${'b'.repeat(40)}`))).toThrow(/another address/);
    expect(alter((b) => (b.quote.minOut = String(BigInt(b.quote.minOut) - 1n)))).toThrow(/less than the minimum/);
    expect(alter((b) => (b.deposit.opReturn = '6a00'))).toThrow(/no memo/);
    expect(alter((b) => (b.quote.route = 'thorchain'))).toThrow(/another route/);
    // The THORChain path refuses a 1Click answer instead of signing a deposit without a memo.
    const thorIntent: OutIntent = { ...intent };
    delete thorIntent.route;
    expect(() => depositExpectation(build, wallet, thorIntent)).toThrow(/another route/);
  });
});

describe('Bring in on 1Click, checked in the page', () => {
  const FROM = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
  const timing = { pollMs: 1, waitMs: 1000, replanMs: 60_000, sleep: async () => {} };

  async function intent(): Promise<InIntent> {
    const q = await api.post<{ quote: { minSats: string; route: string } }>('/api/in/quote', {
      symbol: 'USDC', chain: 'ETH', amount: '500000000', receive: 'BCH', address: userAddress, route: 'near-intents',
    });
    expect(q.quote.route).toBe('near-intents');
    return { symbol: 'USDC', chain, token: chain.tokens.USDC!.address, decimals: 6, amount: 500_000_000n, receive: 'BCH', address: userAddress, minSats: BigInt(q.quote.minSats), route: 'near-intents' };
  }

  it('sends one transfer of the exact token units to the deposit address, with no approval, and records it', async () => {
    const wallet = fakeEip1193({ chainId: chain.id });
    const steps: InStep[] = [];
    const res = await runIn({ api, provider: wallet, from: FROM, intent: await intent(), timing, onStep: (s) => steps.push(s) });
    expect(steps).toEqual(['chain', 'plan', 'deposit', 'record']);
    expect(wallet.sent).toHaveLength(1);
    expect(wallet.sent[0]!.to.toLowerCase()).toBe(chain.tokens.USDC!.address.toLowerCase());
    const call = decodeFunctionData({ abi: ERC20_ABI, data: wallet.sent[0]!.data });
    expect(call.functionName).toBe('transfer');
    expect(String(call.args[0]).toLowerCase()).toBe(synthetic.depositAddresses.evm);
    expect(call.args[1]).toBe(5_000_000n);
    const view = await api.get<{ kind: string; route: string; txid: string }>(`/api/crossings/${res.crossingId}`);
    expect(view).toMatchObject({ kind: 'in', route: 'near-intents' });
  });

  type Plan = { quote: { destination: string; minSats: string; route: string }; deposit: Record<string, unknown> };
  const tampers: Array<[string, (p: Plan) => void]> = [
    ['a quote paying another BCH address', (p) => (p.quote.destination = 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a')],
    ['a quote below the minimum shown', (p) => (p.quote.minSats = '1')],
    ['another amount', (p) => (p.deposit.amount = '1')],
    ['another token contract', (p) => (p.deposit.token = `0x${'11'.repeat(20)}`)],
    ['a router deposit instead of a transfer', (p) => delete p.deposit.kind],
  ];
  it.each(tampers)('refuses a plan with %s before anything is sent', async (_name, tamper) => {
    const tampering: Api = {
      get: (p) => api.get(p),
      post: async <T,>(p: string, body: unknown): Promise<T> => {
        const reply = await api.post<T>(p, body);
        if (p === '/api/in/plan') tamper(reply as unknown as Plan);
        return reply;
      },
    };
    const wallet = fakeEip1193({ chainId: chain.id });
    const run = runIn({ api: tampering, provider: wallet, from: FROM, intent: await intent(), timing, onStep: () => {} });
    await expect(run).rejects.toBeInstanceOf(InStop);
    await expect(run).rejects.toMatchObject({ reason: 'plan_mismatch' });
    expect(wallet.sent).toHaveLength(0);
  });
});
