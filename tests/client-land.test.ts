// The page's landing client against the fake server: open (address recomputed in the browser), pay from the
// connected wallet, and see the finisher convert. A tampered card or payment never reaches the wallet.
import { binToHex } from '@bitauth/libauth';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { makeApi, type Api, type Fetch } from '../core/client/api.js';
import { fakeWalletSession } from '../core/client/fake-wallet.js';
import { LandingMismatch, openLanding, payLanding, type LandingAsk } from '../core/client/land.js';
import { scanWallet } from '../core/client/scan.js';
import type { SignRequest, WalletSession } from '../core/client/session.js';
import { CheckFailure } from '../core/client/swap.js';
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { makeCard } from '../core/landing-card.js';
import { txFromHex, txToHex } from '../core/wire.js';
import { buildApp } from '../server/app.js';
import { createServices } from '../server/services.js';
import { otherLock, PUSD } from './helpers/pools.js';

const config = patchConfig(normalizeConfig(shipped as unknown as SampanConfig), JSON.stringify({ features: { landing: true } }));
let app: FastifyInstance;
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
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-client-land-'));
  const services = createServices({ config, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config, webDist: dist, fake: true, services, startWatcher: false });
});
afterEach(async () => {
  await app.close();
  rmSync(dist, { recursive: true, force: true });
});

const counting = (inner: WalletSession): WalletSession & { calls: SignRequest[] } => {
  const calls: SignRequest[] = [];
  return { name: inner.name, publicKey: inner.publicKey, calls, sign: (r) => (calls.push(r), inner.sign(r)) };
};

/** Rewrites the reply of one endpoint. */
const tampered = (endpoint: string, tamper: (b: Record<string, unknown>) => void): Api => {
  const api = makeApi(injectFetch);
  return {
    get: api.get,
    post: async <T>(p: string, body: unknown): Promise<T> => {
      const r = await api.post<Record<string, unknown>>(p, body);
      if (p === endpoint) tamper(r);
      return r as T;
    },
  };
};

const setup = async (api: Api) => {
  const session = counting(fakeWalletSession());
  const view = await scanWallet(api, session, 'bitcoincash', { gapLimit: config.wallet.gapLimit, maxRounds: 5 });
  const ask: LandingAsk = { ownerAddress: view.receive.tokenAddress, token: 'PUSD', category: PUSD, returnAfter: config.landing.returnAfterBlocks, prefix: 'bitcoincash' };
  return { session, view, ask };
};

const pay = (api: Api, s: Awaited<ReturnType<typeof setup>>, landing: Awaited<ReturnType<typeof openLanding>>) =>
  payLanding({ api, session: s.session, wallet: s.view, landing, sats: 100_000n, feeCapSats: BigInt(config.fees.capSats), userPrompt: 'Pay' });

describe('page landing client on the fake network', { timeout: 30_000 }, () => {
  it('opens, pays once from the wallet, and the kick shows the conversion', async () => {
    const api = makeApi(injectFetch);
    const s = await setup(api);
    const landing = await openLanding(api, s.ask);
    expect(landing.card.address).toMatch(/^bitcoincash:p/);
    const { txid } = await pay(api, s, landing);
    expect(s.session.calls).toHaveLength(1);
    const after = await api.post<{ status: string; landing: { paymentTxid: string } }>(`/api/crossings/${landing.crossingId}/kick`, {});
    expect(after.status).toBe('converted');
    expect(after.landing.paymentTxid).toBe(txid);
  });
});

describe('tampered landings never reach the wallet', { timeout: 30_000 }, () => {
  it('refuses a card that pays someone else, even when its address matches its own parameters', async () => {
    const api = tampered('/api/land/open', (b) => {
      const card = b.card as { rateNum: string; category: string; returnAfter: number; created: string };
      b.card = makeCard(
        { ownerLockHex: binToHex(otherLock), category: card.category, rateNum: BigInt(card.rateNum), rateDen: 100_000_000n, returnAfter: card.returnAfter },
        { network: 'mainnet', token: 'PUSD', created: new Date(card.created) },
      );
    });
    const s = await setup(api);
    await expect(openLanding(api, s.ask)).rejects.toThrow(/someone else/);
  });

  it('refuses a card whose stated address differs from its parameters', async () => {
    const api = tampered('/api/land/open', (b) => {
      (b.card as { address: string }).address = 'bitcoincash:pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
    });
    const s = await setup(api);
    await expect(openLanding(api, s.ask)).rejects.toBeInstanceOf(LandingMismatch);
  });

  const payCases: Array<[string, (b: Record<string, unknown>) => void, number]> = [
    [
      'payment sent to another address',
      (b) => {
        const tx = txFromHex(b.tx as string);
        tx.outputs[0] = { ...tx.outputs[0]!, lockingBytecode: otherLock };
        b.tx = txToHex(tx);
      },
      1,
    ],
    [
      'payment of a different amount',
      (b) => {
        const tx = txFromHex(b.tx as string);
        tx.outputs[0] = { ...tx.outputs[0]!, valueSatoshis: tx.outputs[0]!.valueSatoshis + 50_000n };
        b.tx = txToHex(tx);
      },
      3,
    ],
  ];

  it.each(payCases)('%s', async (_name, tamper, rule) => {
    const api = tampered('/api/land/pay/build', tamper);
    const s = await setup(api);
    const landing = await openLanding(api, s.ask);
    const run = pay(api, s, landing);
    await expect(run).rejects.toBeInstanceOf(CheckFailure);
    await expect(run).rejects.toMatchObject({ rule });
    expect(s.session.calls).toHaveLength(0);
  });
});
