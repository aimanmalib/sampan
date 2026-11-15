// Flow C in the page's own code (core/client/in.ts) against the fake server and a fake EIP-1193 wallet: chain
// switch, exact approval, a fresh plan when the first is old, the deposit simulated and sent, the hash recorded.
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeFunctionData } from 'viem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { makeApi, type Api, type Fetch } from '../core/client/api.js';
import { InStop, runIn, type InIntent, type InStep } from '../core/client/in.js';
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { ERC20_ABI, ROUTER_ABI } from '../core/evm/calldata.js';
import { buildApp } from '../server/app.js';
import { createServices } from '../server/services.js';
import { fakeEip1193 } from './helpers/fake-eip1193.js';
import { userAddress } from './helpers/wallet.js';

const config = patchConfig(
  normalizeConfig(shipped as unknown as SampanConfig),
  JSON.stringify({ compliance: { crossChainEnabled: true }, rate: { quotesPerMinute: 1000, crossingsPerHour: 1000 } }),
);
const chain = config.evm.chains[0]!;
const FROM = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
let app: FastifyInstance;
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
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-client-in-'));
  const services = createServices({ config, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config, webDist: dist, fake: true, services, startWatcher: false });
  api = makeApi(injectFetch);
});
afterEach(async () => {
  await app.close();
  rmSync(dist, { recursive: true, force: true });
});

async function intent(receive: string): Promise<InIntent> {
  const q = await api.post<{ quote: { minSats: string } }>('/api/in/quote', { symbol: 'USDC', chain: 'BASE', amount: '500000000', receive, address: userAddress });
  return {
    symbol: 'USDC',
    chain,
    token: chain.tokens.USDC!,
    amount: 500_000_000n,
    receive,
    address: userAddress,
    minSats: BigInt(q.quote.minSats),
    ...(receive === 'BCH' ? {} : { landing: { category: config.tokens.PUSD!.category, returnAfter: config.landing.returnAfterBlocks, prefix: 'bitcoincash' as const } }),
  };
}

const timing = (clock: { t: number }) => ({ pollMs: 1, waitMs: 1000, replanMs: 60_000, now: () => clock.t, sleep: async () => {} });

describe('runIn', () => {
  it('switches chain, approves the exact amount, plans again when old, deposits and records the hash', async () => {
    const wallet = fakeEip1193({ startChain: 1 });
    const steps: InStep[] = [];
    const clock = { t: Date.now() };
    const res = await runIn({
      api,
      provider: { request: async (a) => { if (a.method === 'eth_sendTransaction') clock.t += 61_000; return wallet.request(a); } },
      from: FROM,
      intent: await intent('PUSD'),
      timing: timing(clock),
      onStep: (s) => steps.push(s),
    });
    expect(steps).toEqual(['chain', 'plan', 'approve', 'confirm', 'plan', 'deposit', 'record']);
    expect(wallet.sent).toHaveLength(2);
    expect(decodeFunctionData({ abi: ERC20_ABI, data: wallet.sent[0]!.data }).args[1]).toBe(5_000_000n);
    const dep = decodeFunctionData({ abi: ROUTER_ABI, data: wallet.sent[1]!.data });
    expect(dep.functionName).toBe('depositWithExpiry');
    expect(String(dep.args[3])).toMatch(/^=:c:p/);
    expect(res.landingId).toMatch(/^[0-9a-f]{32}$/);
    const view = await api.get<{ kind: string; txid: string; landingId: string }>(`/api/crossings/${res.crossingId}`);
    expect(view).toMatchObject({ kind: 'in', txid: res.hash.slice(2).toUpperCase(), landingId: res.landingId });
  });

  it('skips the approval when the allowance covers the amount and sends BCH to the user address', async () => {
    const wallet = fakeEip1193({ allowance: 5_000_000n });
    const steps: InStep[] = [];
    const res = await runIn({ api, provider: wallet, from: FROM, intent: await intent('BCH'), timing: timing({ t: Date.now() }), onStep: (s) => steps.push(s) });
    expect(steps).toEqual(['chain', 'plan', 'deposit', 'record']);
    expect(String(decodeFunctionData({ abi: ROUTER_ABI, data: wallet.sent[0]!.data }).args[3])).toContain(userAddress.slice(12));
    expect(res.landingId).toBeNull();
  });

  it('stops before the wallet signs when the balance is short or the deposit would revert', async () => {
    await expect(runIn({ api, provider: fakeEip1193({ balance: 1n }), from: FROM, intent: await intent('BCH'), timing: timing({ t: Date.now() }), onStep: () => {} })).rejects.toMatchObject({ reason: 'not_enough_tokens' });
    const reverting = fakeEip1193({ allowance: 5_000_000n, revertDeposit: true });
    await expect(runIn({ api, provider: reverting, from: FROM, intent: await intent('BCH'), timing: timing({ t: Date.now() }), onStep: () => {} })).rejects.toBeInstanceOf(InStop);
    expect(reverting.sent).toHaveLength(0);
  });

  it('refuses a plan whose minimum is above what the route now offers', async () => {
    const i = { ...(await intent('BCH')), minSats: 10n ** 12n };
    await expect(runIn({ api, provider: fakeEip1193(), from: FROM, intent: i, timing: timing({ t: Date.now() }), onStep: () => {} })).rejects.toMatchObject({ code: 'price_moved' });
  });
});
