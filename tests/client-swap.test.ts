// The page's swap client against the fake server: scan from public keys, quote, build, browser check, sign,
// broadcast. Sabotaged builds must stop before the wallet is asked to sign.
import { binToHex } from '@bitauth/libauth';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApi, type Api, type Fetch } from '../core/client/api.js';
import { fakeWalletSession } from '../core/client/fake-wallet.js';
import { scanWallet } from '../core/client/scan.js';
import type { SignRequest, WalletSession } from '../core/client/session.js';
import { CheckFailure, quoteSwap, runSwap, type SwapIntent } from '../core/client/swap.js';
import { normalizeConfig, type SampanConfig } from '../core/config.js';
import { txFromHex, txToHex } from '../core/wire.js';
import shipped from '../config/sampan.json' with { type: 'json' };
import { buildApp } from '../server/app.js';
import { BroadcastError } from '../server/chain/types.js';
import { createServices, FAKE_WALLET, type Services } from '../server/services.js';
import { otherLock, PUSD } from './helpers/pools.js';

const config = normalizeConfig(shipped as unknown as SampanConfig);
let app: FastifyInstance;
let services: Services;
let dist: string;

const injectFetch: Fetch = async (url, init) => {
  const res = await app.inject({
    method: (init?.method ?? 'GET') as 'GET' | 'POST',
    url,
    ...(init?.body ? { payload: init.body, headers: { 'content-type': 'application/json' } } : {}),
  });
  return { ok: res.statusCode < 400, status: res.statusCode, json: async () => res.json() };
};

beforeEach(async () => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-client-'));
  services = createServices({ config, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config, webDist: dist, fake: true, services });
});
afterEach(async () => {
  await app.close();
  rmSync(dist, { recursive: true, force: true });
});

const scanOpts = { gapLimit: config.wallet.gapLimit, maxRounds: 5 };
const category = PUSD.toLowerCase();

/** Counts sign calls so a test can prove the wallet was never asked. */
const counting = (inner: WalletSession): WalletSession & { calls: SignRequest[] } => {
  const calls: SignRequest[] = [];
  return { name: inner.name, publicKey: inner.publicKey, calls, sign: (r) => (calls.push(r), inner.sign(r)) };
};

const intentFor = async (api: Api, side: 'buy' | 'sell', amount: bigint): Promise<SwapIntent> => {
  const q = await quoteSwap(api, { token: 'PUSD', side, amount });
  return { token: 'PUSD', side, amount, minReceive: BigInt(q.minReceive), category, feeCapSats: BigInt(config.fees.capSats), userPrompt: 'Swap' };
};

describe('page swap client on the fake network', { timeout: 30_000 }, () => {
  it('scans the funded first address and picks the next unused receive and change addresses', async () => {
    const api = makeApi(injectFetch);
    const view = await scanWallet(api, fakeWalletSession(), 'bitcoincash', scanOpts);
    // BCH carried by token outputs is not counted as spendable.
    expect(view.sats).toBe(FAKE_WALLET.sats);
    expect(view.tokens[category]).toBe(FAKE_WALLET.tokens);
    expect(`${view.receive.path}/${view.receive.index}`).toBe('receive/1');
    expect(`${view.change.path}/${view.change.index}`).toBe('change/0');
    expect(view.derived.length).toBeGreaterThanOrEqual(3 * config.wallet.gapLimit);
  });

  it('buys PUSD, then sells some back; the wallet signs once per swap and the balances move', async () => {
    const api = makeApi(injectFetch);
    const session = counting(fakeWalletSession());
    let view = await scanWallet(api, session, 'bitcoincash', scanOpts);
    const buy = await intentFor(api, 'buy', 100_000n);
    const steps: string[] = [];
    const bought = await runSwap({ api, session, wallet: view, intent: buy, onStep: (s) => steps.push(s) });
    expect(bought.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(steps).toEqual(['building', 'checking', 'signing', 'sending']);
    view = await scanWallet(api, session, 'bitcoincash', scanOpts);
    expect(view.tokens[category]! - FAKE_WALLET.tokens).toBeGreaterThanOrEqual(buy.minReceive);

    const sell = await intentFor(api, 'sell', 100n);
    const sold = await runSwap({ api, session, wallet: view, intent: sell });
    expect(sold.txid).not.toBe(bought.txid);
    expect(session.calls).toHaveLength(2);
    const crossing = (await app.inject({ method: 'GET', url: `/api/crossings/${sold.crossingId}` })).json();
    expect(crossing).toMatchObject({ id: sold.crossingId, kind: 'swap', status: 'broadcast', txid: sold.txid });
  });

  it('a pool spent first: the same crossing is rebuilt and signed again', async () => {
    const api = makeApi(injectFetch);
    const session = counting(fakeWalletSession());
    const view = await scanWallet(api, session, 'bitcoincash', scanOpts);
    const real = services.chain.broadcast.bind(services.chain);
    let first = true;
    services.chain.broadcast = async (hex) => {
      if (first) {
        first = false;
        throw new BroadcastError('bad-txns-inputs-missingorspent');
      }
      return real(hex);
    };
    const res = await runSwap({ api, session, wallet: view, intent: await intentFor(api, 'buy', 100_000n) });
    expect(res.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(session.calls).toHaveLength(2);
  });
});

describe('sabotaged builds never reach the wallet', { timeout: 30_000 }, () => {
  /** Wraps the API so /api/swap/build replies are rewritten by `tamper`. */
  const tampered = (tamper: (b: Record<string, unknown>) => void): Api => {
    const api = makeApi(injectFetch);
    return {
      get: api.get,
      post: async <T>(p: string, body: unknown): Promise<T> => {
        const r = await api.post<Record<string, unknown>>(p, body);
        if (p === '/api/swap/build') tamper(r);
        return r as T;
      },
    };
  };

  const cases: Array<[string, (b: Record<string, unknown>) => void, number]> = [
    [
      'payout redirected to a stranger',
      (b) => {
        const tx = txFromHex(b.tx as string);
        const last = tx.outputs.length - 2;
        tx.outputs[last] = { ...tx.outputs[last]!, lockingBytecode: otherLock };
        b.tx = txToHex(tx);
      },
      1,
    ],
    [
      'server claims the stranger is the user',
      (b) => {
        const tx = txFromHex(b.tx as string);
        const last = tx.outputs.length - 2;
        tx.outputs[last] = { ...tx.outputs[last]!, lockingBytecode: otherLock };
        b.tx = txToHex(tx);
        const e = b.expectation as { userLockingBytecodes: string[] };
        e.userLockingBytecodes.push(binToHex(otherLock));
      },
      1,
    ],
    [
      'input path points at another address',
      (b) => {
        const paths = b.inputPaths as Array<{ inputIndex: number; path: string }>;
        paths[0] = { ...paths[0]!, path: 'receive/5' };
      },
      5,
    ],
    [
      'lower minimum than shown',
      (b) => {
        const e = b.expectation as { receive: { min: string } };
        e.receive.min = '1';
        const tx = txFromHex(b.tx as string);
        const out = tx.outputs.find((o) => o.token && binToHex(o.token.category) === category && o.lockingBytecode.length === 25);
        if (out?.token) out.token = { ...out.token, amount: 1n };
        b.tx = txToHex(tx);
      },
      4,
    ],
  ];

  it.each(cases)('%s', async (_name, tamper, rule) => {
    const api = tampered(tamper);
    const session = counting(fakeWalletSession());
    const view = await scanWallet(api, session, 'bitcoincash', scanOpts);
    const run = runSwap({ api, session, wallet: view, intent: await intentFor(api, 'buy', 100_000n) });
    await expect(run).rejects.toBeInstanceOf(CheckFailure);
    await expect(run).rejects.toMatchObject({ rule });
    expect(session.calls).toHaveLength(0);
  });
});
