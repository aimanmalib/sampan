// Flow L through the API on the fake network: open a landing address, recompute it from the card as the page
// does, pay it from a wallet (checked like a swap), and watch the finisher turn the BCH into tokens.
import { binToHex, decodeTransaction, encodeTransaction, hexToBin } from '@bitauth/libauth';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { checkTransaction } from '../core/check.js';
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { readCard } from '../core/landing-card.js';
import { LANDING_RATE_DEN, landingAddress } from '../core/landing.js';
import { signP2pkhInputs } from '../core/tx/sign.js';
import { expectationFromWire, outputFromWire, type WireExpectation, type WireOutput } from '../core/wire.js';
import { buildApp } from '../server/app.js';
import { createServices, type Services } from '../server/services.js';
import { PUSD, testKey } from './helpers/pools.js';
import { blankAddresses, userAddress, userLockHex, userTokenAddress } from './helpers/wallet.js';

const base = normalizeConfig(shipped as unknown as SampanConfig);
const open = patchConfig(base, JSON.stringify({ features: { landing: true } }));
let app: FastifyInstance;
let services: Services;
let dist: string;

const start = async (c: SampanConfig) => {
  services = createServices({ config: c, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config: c, webDist: dist, fake: true, services, startWatcher: false });
};

beforeEach(async () => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-land-'));
  await start(open);
});
afterEach(async () => {
  await app.close();
  rmSync(dist, { recursive: true, force: true });
});

const post = (url: string, payload?: unknown) => app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });

interface Opened {
  crossingId: string;
  card: unknown;
  minSats: string;
  tokensMin: string;
  validHours: number;
}

interface PayReply {
  crossingId: string;
  tx: string;
  sourceOutputs: WireOutput[];
  inputPaths: Array<{ inputIndex: number; path: string }>;
  expectation: WireExpectation;
}

const openLanding = async (owner = userTokenAddress): Promise<Opened> => {
  const res = await post('/api/land/open', { ownerAddress: owner, token: 'PUSD' });
  expect(res.statusCode).toBe(200);
  return res.json() as Opened;
};

describe('landing API', () => {
  it('is closed while features.landing is off', async () => {
    await app.close();
    await start({ ...base, features: { ...base.features, landing: false } });
    const res = await post('/api/land/open', { ownerAddress: userTokenAddress, token: 'PUSD' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'flow_closed' });
  });

  it('opens an address whose card recomputes to the same address, at the worst-case minimum rate', async () => {
    const o = await openLanding();
    const read = readCard(o.card);
    if (typeof read === 'string') throw new Error(read);
    expect(landingAddress(read.params, 'bitcoincash')).toBe(read.card.address);
    expect(read.params.ownerLockHex).toBe(userLockHex);
    expect(read.params.category).toBe(PUSD);
    expect(read.params.returnAfter).toBe(open.landing.returnAfterBlocks);
    expect(BigInt(o.minSats)).toBe(BigInt(open.limits.localMinSats));
    expect(read.params.rateNum).toBe((BigInt(o.tokensMin) * LANDING_RATE_DEN) / BigInt(o.minSats));
    expect(o.validHours).toBe(open.landing.validHours);
    // Same owner, same pools: the same address and crossing come back.
    expect((await openLanding()).crossingId).toBe(o.crossingId);
    const status = (await app.inject({ method: 'GET', url: `/api/crossings/${o.crossingId}` })).json() as Record<string, unknown>;
    expect(status).toMatchObject({ kind: 'land', status: 'open', landing: { address: read.card.address, paymentTxid: null, watching: true } });
  });

  it('refuses an owner address that is not a cash address', async () => {
    const res = await post('/api/land/open', { ownerAddress: 'bitcoincash:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', token: 'PUSD' });
    expect(res.statusCode).toBe(400);
  });

  it('pays from a wallet, passes the page check, and the finisher converts it to tokens for the owner', async () => {
    const o = await openLanding();
    await post('/api/wallet/scan', { start: 0, paths: { receive: [userAddress, ...blankAddresses(19)] } });
    const amount = 100_000n;
    const res = await post('/api/land/pay/build', {
      crossingId: o.crossingId,
      amount: amount.toString(),
      addresses: [{ address: userAddress, path: 'receive/0' }],
      changeAddress: userAddress,
    });
    expect(res.statusCode).toBe(200);
    const b = res.json() as PayReply;
    const tx = decodeTransaction(hexToBin(b.tx));
    if (typeof tx === 'string') throw new Error(tx);
    const sources = b.sourceOutputs.map(outputFromWire);
    const read = readCard(o.card);
    if (typeof read === 'string') throw new Error(read);
    // The page's own expectation: its addresses, the landing lock it recomputed, the amount it showed.
    const landingLock = expectationFromWire(b.expectation).deposits![0]!.lockingBytecode;
    const expectation = {
      userLockingBytecodes: [userLockHex],
      inputPaths: b.inputPaths,
      poolOwnerPkhs: [],
      deposits: [{ lockingBytecode: landingLock, sats: amount }],
      spend: { sats: amount, tokens: {} },
      feeCapSats: BigInt(open.fees.capSats),
      receive: { category: PUSD, min: 0n },
    };
    expect(checkTransaction(tx, sources, expectation)).toEqual({ ok: true });
    expect(checkTransaction(tx, sources, { ...expectation, deposits: [{ lockingBytecode: landingLock, sats: amount - 1n }] }).ok).toBe(false);

    const signed = binToHex(encodeTransaction(signP2pkhInputs(tx, sources, b.inputPaths.map((p) => p.inputIndex), testKey)));
    const sent = await post('/api/broadcast', { crossingId: o.crossingId, tx: signed });
    expect(sent.statusCode).toBe(200);
    const paid = (sent.json() as { txid: string }).txid;

    const kicked = (await post(`/api/crossings/${o.crossingId}/kick`)).json() as { status: string; txid: string; landing: { paymentTxid: string } };
    expect(kicked.status).toBe('converted');
    expect(kicked.landing.paymentTxid).toBe(paid);
    expect(kicked.txid).toMatch(/^[0-9a-f]{64}$/);
    const owner = await services.chain.listUnspent(userLockHex);
    expect(owner.some((u) => u.txid === kicked.txid && u.token?.category === PUSD)).toBe(true);

    const stats = (await app.inject({ method: 'GET', url: '/api/stats' })).json() as {
      all: { completed: number };
      public: { completed: number; medianSeconds: number };
      test: { completed: number };
    };
    expect(stats.all.completed).toBe(1);
    expect(stats.public.completed).toBe(1);
    expect(stats.test.completed).toBe(0);
    expect(typeof stats.public.medianSeconds).toBe('number');
  });

  it('refuses a payment below the minimum and one for an unknown crossing', async () => {
    const o = await openLanding();
    const body = { addresses: [{ address: userAddress, path: 'receive/0' }], changeAddress: userAddress };
    const low = await post('/api/land/pay/build', { ...body, crossingId: o.crossingId, amount: String(open.limits.localMinSats - 1) });
    expect(low.json()).toMatchObject({ error: 'below_min' });
    const unknown = await post('/api/land/pay/build', { ...body, crossingId: 'f'.repeat(32), amount: '100000' });
    expect(unknown.statusCode).toBe(404);
  });

  it('refuses a payment worth more than limits.maxUsd at the address rate', async () => {
    const o = await openLanding();
    const body = { addresses: [{ address: userAddress, path: 'receive/0' }], changeAddress: userAddress };
    const read = readCard(o.card);
    if (typeof read === 'string') throw new Error(read);
    const { card } = read;
    const capTokens = BigInt(Math.round(open.limits.maxUsd * 10 ** open.tokens.PUSD!.decimals));
    const atCap = (capTokens * BigInt(card.rateDen)) / BigInt(card.rateNum);
    const over = await post('/api/land/pay/build', { ...body, crossingId: o.crossingId, amount: String(atCap + atCap / 100n) });
    expect(over.statusCode).toBe(400);
    expect(over.json()).toMatchObject({ error: 'above_max' });
    const under = await post('/api/land/pay/build', { ...body, crossingId: o.crossingId, amount: String(atCap - atCap / 100n) });
    expect(under.json()).not.toMatchObject({ error: 'above_max' });
  });
});
