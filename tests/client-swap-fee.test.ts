// The Sampan fee end to end on the fake network: a local server with business.feeBps on builds one fee output,
// the page's check accepts it only when the page's own config names the same address and rate, and a fee to
// another address stops before the wallet is asked to sign.
import { binToHex } from '@bitauth/libauth';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { feeLockingHex } from '../core/business.js';
import { makeApi, type Fetch } from '../core/client/api.js';
import { fakeWalletSession } from '../core/client/fake-wallet.js';
import { scanWallet } from '../core/client/scan.js';
import type { SignRequest, WalletSession } from '../core/client/session.js';
import { CheckFailure, quoteSwap, runSwap, type SwapIntent } from '../core/client/swap.js';
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { txFromHex } from '../core/wire.js';
import shipped from '../config/sampan.json' with { type: 'json' };
import { buildApp } from '../server/app.js';
import { createServices } from '../server/services.js';
import { PUSD } from './helpers/pools.js';

// Fixture fee addresses (P2PKH), not the shipped config value.
const FEE_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const OTHER_ADDRESS = 'bitcoincash:qplrydnf2z4pj4z9rv7uhmwsuxyrm8hj7u3nqeslpn';
const BPS = 30;
const feeOn = (feeAddress: string): SampanConfig =>
  patchConfig(normalizeConfig(shipped as unknown as SampanConfig), JSON.stringify({ business: { feeBps: BPS, feeAddress } }));

let app: FastifyInstance | undefined;
let dist: string | undefined;
const start = async (config: SampanConfig): Promise<Fetch> => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-fee-'));
  const services = createServices({ config, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  const a = await buildApp({ config, webDist: dist, fake: true, services });
  app = a;
  return async (url, init) => {
    const res = await a.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url,
      ...(init?.body ? { payload: init.body, headers: { 'content-type': 'application/json' } } : {}),
    });
    return { ok: res.statusCode < 400, status: res.statusCode, json: async () => res.json() };
  };
};
afterEach(async () => {
  await app?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const recording = (inner: WalletSession): WalletSession & { calls: SignRequest[] } => {
  const calls: SignRequest[] = [];
  return { name: inner.name, publicKey: inner.publicKey, calls, sign: (r) => (calls.push(r), inner.sign(r)) };
};

async function setUp(serverFee: string, pageFee: string, side: 'buy' | 'sell', amount: bigint) {
  const config = feeOn(serverFee);
  const api = makeApi(await start(config));
  const session = recording(fakeWalletSession());
  const view = await scanWallet(api, session, 'bitcoincash', { gapLimit: config.wallet.gapLimit, maxRounds: 5 });
  const q = await quoteSwap(api, { token: 'PUSD', side, amount });
  const intent: SwapIntent = {
    token: 'PUSD', side, amount, minReceive: BigInt(q.minReceive), category: PUSD.toLowerCase(),
    feeCapSats: BigInt(config.fees.capSats), userPrompt: 'Swap', business: { feeBps: BPS, feeAddress: pageFee },
  };
  return { api, session, view, q, intent };
}

describe('Sampan fee on the fake network', { timeout: 30_000 }, () => {
  it('buy: the quote names the fee, the transaction pays exactly that to the fee address, the wallet signs once', async () => {
    const { api, session, view, q, intent } = await setUp(FEE_ADDRESS, FEE_ADDRESS, 'buy', 1_000_000n);
    expect(BigInt(q.sampanFeeSats)).toBe((BigInt(q.supply) * BigInt(BPS)) / 10_000n);
    await expect(runSwap({ api, session, wallet: view, intent })).resolves.toMatchObject({ txid: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(session.calls).toHaveLength(1);
    const outs = txFromHex(session.calls[0]!.tx).outputs;
    const last = outs[outs.length - 1]!;
    expect(binToHex(last.lockingBytecode)).toBe(feeLockingHex({ feeBps: BPS, feeAddress: FEE_ADDRESS }, 'bitcoincash'));
    expect(last.valueSatoshis).toBe(BigInt(q.sampanFeeSats));
  });

  it('sell: the minimum shown is already net of the fee and the swap goes through', async () => {
    const { api, session, view, q, intent } = await setUp(FEE_ADDRESS, FEE_ADDRESS, 'sell', 5_000n);
    expect(BigInt(q.sampanFeeSats)).toBeGreaterThan(0n);
    expect(BigInt(q.minReceive)).toBeLessThan(BigInt(q.demand) - BigInt(q.sampanFeeSats));
    await expect(runSwap({ api, session, wallet: view, intent })).resolves.toMatchObject({ txid: expect.any(String) });
  });

  it('sabotage: a server paying the fee to another address is stopped before the wallet signs', async () => {
    const { api, session, view, intent } = await setUp(OTHER_ADDRESS, FEE_ADDRESS, 'buy', 1_000_000n);
    const run = runSwap({ api, session, wallet: view, intent });
    await expect(run).rejects.toBeInstanceOf(CheckFailure);
    await expect(run).rejects.toMatchObject({ rule: 1 });
    expect(session.calls).toHaveLength(0);
  });
});
