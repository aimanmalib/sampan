// Flow C in the page's own code (core/client/in.ts) against the fake server and a fake EIP-1193 wallet: chain
// switch, exact approval, a fresh plan when the first is old, the deposit simulated and sent, the hash recorded;
// and a plan altered between the server and the page is refused before the wallet is asked to sign anything.
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
import { withLive } from '../core/route-assets.js';
import { ERC20_ABI, ROUTER_ABI } from '../core/evm/calldata.js';
import { makeCard, readCard } from '../core/landing-card.js';
import type { LandingParams } from '../core/landing.js';
import { withoutPrefix } from '../core/routes/memo.js';
import { buildApp } from '../server/app.js';
import { createServices } from '../server/services.js';
import { fakeEip1193 } from './helpers/fake-eip1193.js';
import { otherLockHex, userAddress } from './helpers/wallet.js';

const shippedConfig = normalizeConfig(shipped as unknown as SampanConfig);
const config = patchConfig(
  shippedConfig,
  JSON.stringify({ compliance: { crossChainEnabled: true }, thorchain: { assets: withLive(shippedConfig.thorchain.assets, ['BASE']) }, rate: { quotesPerMinute: 1000, crossingsPerHour: 1000 } }),
);
const chain = config.evm.chains.find((c) => c.key === 'BASE')!;
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
    token: chain.tokens.USDC!.address,
    decimals: chain.tokens.USDC!.decimals,
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

  it('approves the exact amount in the decimals config lists for the token (18 on BNB Smart Chain)', async () => {
    const wallet = fakeEip1193({ decimals: 18, balance: 10n ** 19n });
    const i = { ...(await intent('BCH')), decimals: 18 };
    await runIn({ api, provider: wallet, from: FROM, intent: i, timing: timing({ t: Date.now() }), onStep: () => {} });
    // 500000000 route units (1e8) = 5 tokens = 5 * 10^18 token units.
    expect(decodeFunctionData({ abi: ERC20_ABI, data: wallet.sent[0]!.data }).args[1]).toBe(5n * 10n ** 18n);
  });

  it('stops before the wallet signs when the token reports other decimals than config lists', async () => {
    const wallet = fakeEip1193({ decimals: 18, balance: 10n ** 19n });
    await expect(runIn({ api, provider: wallet, from: FROM, intent: await intent('BCH'), timing: timing({ t: Date.now() }), onStep: () => {} })).rejects.toMatchObject({ reason: 'plan_mismatch' });
    expect(wallet.sent).toHaveLength(0);
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

  type Plan = { deposit: { token: string; amount: string; memo: string }; landing?: { card: Record<string, unknown> } };
  const OTHER_BCH = 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a';
  const parts = (memo: string) => memo.split(':');
  const payTo = (p: Plan, address: string) => { const m = parts(p.deposit.memo); m[2] = withoutPrefix(address); p.deposit.memo = m.join(':'); };
  // A server that lies consistently: a well-formed card for different terms, and a memo paying that card's address.
  const reissue = (p: Plan, change: Partial<LandingParams>) => {
    const read = readCard(p.landing!.card);
    if (typeof read === 'string') throw new Error(read);
    const card = makeCard({ ...read.params, ...change }, { network: read.card.network, token: read.card.token, created: new Date(read.card.created) });
    p.landing!.card = card as unknown as Record<string, unknown>;
    payTo(p, card.address);
  };
  const tampers: Array<[string, string, (p: Plan) => void]> = [
    ['memo pays another BCH address', 'BCH', (p) => { const m = parts(p.deposit.memo); m[2] = OTHER_BCH; p.deposit.memo = m.join(':'); }],
    ['memo limit below the minimum shown', 'BCH', (p) => { const m = parts(p.deposit.memo); m[3] = '10'; p.deposit.memo = m.join(':'); }],
    ['another token contract', 'BCH', (p) => { p.deposit.token = '0x' + '11'.repeat(20); }],
    ['another amount', 'BCH', (p) => { p.deposit.amount = '1'; }],
    ['a landing address nobody asked for', 'BCH', (p) => { p.landing = { card: {} }; }],
    ['no landing address when one was asked for', 'PUSD', (p) => { delete p.landing; payTo(p, userAddress); }],
    ['landing card for another token', 'PUSD', (p) => reissue(p, { category: 'ab'.repeat(32) })],
    ['landing card paying another owner', 'PUSD', (p) => reissue(p, { ownerLockHex: otherLockHex })],
    ['landing card waiting another number of blocks', 'PUSD', (p) => reissue(p, { returnAfter: config.landing.returnAfterBlocks + 1 })],
    ['memo pays a BCH address other than the landing card', 'PUSD', (p) => { const m = parts(p.deposit.memo); m[2] = OTHER_BCH; p.deposit.memo = m.join(':'); }],
  ];

  it.each(tampers)('refuses a plan with %s before any approval or deposit is sent', async (_name, receive, tamper) => {
    const tampering: Api = {
      get: (p) => api.get(p),
      post: async <T,>(p: string, body: unknown): Promise<T> => {
        const reply = await api.post<T>(p, body);
        if (p === '/api/in/plan') tamper(reply as unknown as Plan);
        return reply;
      },
    };
    const wallet = fakeEip1193();
    const run = runIn({ api: tampering, provider: wallet, from: FROM, intent: await intent(receive), timing: timing({ t: Date.now() }), onStep: () => {} });
    await expect(run).rejects.toBeInstanceOf(InStop);
    await expect(run).rejects.toMatchObject({ reason: 'plan_mismatch' });
    expect(wallet.sent).toHaveLength(0);
  });
});
