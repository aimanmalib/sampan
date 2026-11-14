// The swap API end to end on the fake network: scan, quote, build, the page's check, sign, broadcast, rescan.
import { binToHex, decodeTransaction, encodeTransaction, hexToBin } from '@bitauth/libauth';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkTransaction, type Expectation } from '../core/check.js';
import { normalizeConfig, type SampanConfig } from '../core/config.js';
import shipped from '../config/sampan.json' with { type: 'json' };
import { buildApp } from '../server/app.js';
import { outputFromWire, type WireOutput } from '../server/api/wire.js';
import { BroadcastError } from '../server/chain/types.js';
import { createServices, type Services } from '../server/services.js';
import { signP2pkhInputs } from '../core/tx/sign.js';
import { PUSD, testKey } from './helpers/pools.js';
import { blankAddresses, userAddress, userTokenAddress } from './helpers/wallet.js';

const config = normalizeConfig(shipped as unknown as SampanConfig);
let app: FastifyInstance;
let services: Services;
let dist: string;

const start = async (c: SampanConfig = config) => {
  services = createServices({ config: c, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config: c, webDist: dist, fake: true, services });
};

beforeEach(async () => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-api-'));
  await start();
});
afterEach(async () => {
  await app.close();
  rmSync(dist, { recursive: true, force: true });
});

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
const wallet = [
  { address: userAddress, path: 'receive/0' },
  { address: userTokenAddress, path: 'receive/0' },
];

interface BuildBody {
  crossingId: string;
  tx: string;
  sourceOutputs: WireOutput[];
  inputPaths: Expectation['inputPaths'];
  expectation: {
    userLockingBytecodes: string[];
    poolOwnerPkhs: string[];
    spend: { sats: string; tokens: Record<string, string> };
    feeCapSats: string;
    receive: { category: string; min: string };
  };
  quote: { minReceive: string };
}

const scan = async () => post('/api/wallet/scan', { start: 0, paths: { receive: [userAddress, ...blankAddresses(19)] } });

const buyBuild = async (extra: Record<string, unknown> = {}) => {
  const quote = (await post('/api/swap/quote', { token: 'PUSD', side: 'buy', amount: '300000' })).json() as { quote: { minReceive: string } };
  return post('/api/swap/build', {
    token: 'PUSD',
    side: 'buy',
    amount: '300000',
    minReceive: quote.quote.minReceive,
    addresses: wallet,
    payoutAddress: userTokenAddress,
    changeAddress: userAddress,
    ...extra,
  });
};

const signBody = (b: BuildBody): string => {
  const tx = decodeTransaction(hexToBin(b.tx));
  if (typeof tx === 'string') throw new Error(tx);
  const sources = b.sourceOutputs.map(outputFromWire);
  return binToHex(encodeTransaction(signP2pkhInputs(tx, sources, b.inputPaths.map((p) => p.inputIndex), testKey)));
};

describe('swap API on the fake network', () => {
  it('scan -> quote -> build -> checkTransaction -> sign -> broadcast -> rescan shows the tokens', async () => {
    const first = await scan();
    expect(first.statusCode).toBe(200);
    const coins = first.json().paths.receive.addresses[0].utxos as Array<{ sats: string; token?: { amount: string } }>;
    const tokensBefore = coins.reduce((s, u) => s + BigInt(u.token?.amount ?? 0), 0n);
    expect(first.json().paths.receive.more).toBe(true);

    const res = await buyBuild();
    expect(res.statusCode).toBe(200);
    const b = res.json() as BuildBody;
    const tx = decodeTransaction(hexToBin(b.tx));
    if (typeof tx === 'string') throw new Error(tx);
    const e = b.expectation;
    const check = checkTransaction(tx, b.sourceOutputs.map(outputFromWire), {
      userLockingBytecodes: e.userLockingBytecodes,
      inputPaths: b.inputPaths,
      poolOwnerPkhs: e.poolOwnerPkhs,
      spend: { sats: BigInt(e.spend.sats), tokens: {} },
      feeCapSats: BigInt(e.feeCapSats),
      receive: { category: e.receive.category, min: BigInt(e.receive.min) },
    });
    expect(check).toEqual({ ok: true });
    expect(e.receive.category).toBe(PUSD);

    const sent = await post('/api/broadcast', { crossingId: b.crossingId, tx: signBody(b) });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().txid).toMatch(/^[0-9a-f]{64}$/);
    const row = services.db.getCrossing(b.crossingId)!;
    expect(row).toMatchObject({ kind: 'swap', status: 'broadcast', txid: sent.json().txid, origin: 'public' });

    const after = (await scan()).json();
    const all = after.paths.receive.addresses[0].utxos as Array<{ token?: { amount: string } }>;
    const tokensAfter = all.reduce((s, u) => s + BigInt(u.token?.amount ?? 0), 0n);
    expect(tokensAfter - tokensBefore).toBeGreaterThanOrEqual(BigInt(b.quote.minReceive));
  });

  it('refuses a signed transaction that is not valid and sends nothing', async () => {
    await scan();
    const b = (await buyBuild()).json() as BuildBody;
    const unsigned = await post('/api/broadcast', { crossingId: b.crossingId, tx: b.tx });
    expect(unsigned.statusCode).toBe(400);
    expect(unsigned.json().error).toBe('invalid_transaction');
    expect(services.db.getCrossing(b.crossingId)!.status).toBe('built');
  });

  it('a pool spent first by someone else: 409 stale_inputs, then a rebuild of the same crossing succeeds', async () => {
    await scan();
    const b = (await buyBuild()).json() as BuildBody;
    const real = services.chain.broadcast.bind(services.chain);
    services.chain.broadcast = async () => Promise.reject(new BroadcastError('bad-txns-inputs-missingorspent'));
    const stale = await post('/api/broadcast', { crossingId: b.crossingId, tx: signBody(b) });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('stale_inputs');
    services.chain.broadcast = real;
    const again = await buyBuild({ crossingId: b.crossingId });
    expect(again.statusCode).toBe(200);
    expect(again.json().crossingId).toBe(b.crossingId);
    const sent = await post('/api/broadcast', { crossingId: b.crossingId, tx: signBody(again.json() as BuildBody) });
    expect(sent.statusCode).toBe(200);
    expect(services.db.getCrossing(b.crossingId)!.attempts).toBe(1);
  });

  it('records crossings from the project test wallet as origin test', async () => {
    const c = { ...config, ops: { ...config.ops, testAddresses: [userAddress] } };
    await app.close();
    await start(c);
    await scan();
    const b = (await buyBuild()).json() as BuildBody;
    expect(services.db.getCrossing(b.crossingId)!.origin).toBe('test');
  });

  it('answers 429 once a caller is over quotesPerMinute', async () => {
    const c = { ...config, rate: { ...config.rate, quotesPerMinute: 2 } };
    await app.close();
    await start(c);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await post('/api/swap/quote', { token: 'PUSD', side: 'buy', amount: '300000' })).statusCode);
    expect(codes).toEqual([200, 200, 429]);
  });

  it('validates bodies: bad amount, unknown field, unknown crossing', async () => {
    expect((await post('/api/swap/quote', { token: 'PUSD', side: 'buy', amount: '1.5' })).statusCode).toBe(400);
    expect((await post('/api/swap/quote', { token: 'PUSD', side: 'buy', amount: '300000', x: 1 })).statusCode).toBe(400);
    expect((await post('/api/broadcast', { crossingId: 'ab'.repeat(16), tx: '00'.repeat(60) })).statusCode).toBe(404);
  });
});
