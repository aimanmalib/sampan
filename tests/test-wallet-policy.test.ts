// The headless test wallet signs only what checkTransaction approves for the caller's intent, within budget.
// Requests travel in the real WizardConnect relay format (the page's encoder, the wallet's decoder).
import type { SignTransactionRequest } from '@wizardconnect/core';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApi, type Fetch } from '../core/client/api.js';
import { FAKE_WALLET_PHRASE } from '../core/client/fake-wallet.js';
import { relaySourceOutputs } from '../core/client/relay.js';
import { scanWallet } from '../core/client/scan.js';
import { hdKeysFromPhrase, type WalletSession } from '../core/client/session.js';
import { quoteSwap, runSwap } from '../core/client/swap.js';
import { normalizeConfig, type SampanConfig } from '../core/config.js';
import { toWizardInputPaths } from '../core/wallet.js';
import shipped from '../config/sampan.json' with { type: 'json' };
import { buildApp } from '../server/app.js';
import { createServices } from '../server/services.js';
import { testWalletAdapter } from '../tools/test-wallet/adapter.js';
import { record, spentOn } from '../tools/test-wallet/ledger.js';
import { review, type Budget, type Intent } from '../tools/test-wallet/policy.js';
import { BCH } from '../core/check.js';
import { PUSD } from './helpers/pools.js';
import { LANDING_RATE_DEN, landingLockingHex } from '../core/landing.js';
import { buildPayment } from '../core/tx/payment.js';
import { deriveAddress } from '../core/wallet.js';
import { outputToWire, txToHex } from '../core/wire.js';

const config = normalizeConfig(shipped as unknown as SampanConfig);
const budget: Budget = { maxUsdPerTx: 3, maxUsdPerDay: 12 };
const keys = hdKeysFromPhrase(FAKE_WALLET_PHRASE);
let app: FastifyInstance;
let dir: string;

const injectFetch: Fetch = async (url, init) => {
  const res = await app.inject({
    method: (init?.method ?? 'GET') as 'GET' | 'POST',
    url,
    ...(init?.body ? { payload: init.body, headers: { 'content-type': 'application/json' } } : {}),
  });
  return { ok: res.statusCode < 400, status: res.statusCode, json: async () => res.json() };
};

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'sampan-tw-'));
  const services = createServices({ config, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config, webDist: dir, fake: true, services });
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A page session whose wallet is the test wallet, reached through hdwalletv1 sign requests. */
async function swapThroughTestWallet(intentFor: (min: bigint) => Intent, spentBefore = 0, trade: { side: 'buy' | 'sell'; amount: bigint } = { side: 'buy', amount: 100_000n }) {
  const api = makeApi(injectFetch);
  const ledger = path.join(dir, 'ledger.jsonl');
  if (spentBefore > 0) record(ledger, { utc: new Date().toISOString(), usd: spentBefore, prompt: 'earlier' });
  const quote = await quoteSwap(api, { token: 'PUSD', ...trade });
  const intent = intentFor(BigInt(quote.minReceive));
  let sequence = 0;
  const session: WalletSession = {
    name: 'test wallet',
    publicKey: keys.publicKey,
    async sign(r) {
      const view = await scanWallet(api, session, 'bitcoincash', { gapLimit: config.wallet.gapLimit, maxRounds: 3 });
      const adapter = testWalletAdapter(keys, {
        approve: (ask) =>
          review(ask, { ownLocks: view.derived.map((a) => a.lockingHex), intent, budget, spentTodayUsd: spentOn(ledger, new Date().toISOString().slice(0, 10)), feeCapSats: BigInt(config.fees.capSats) }),
        signed: (ask) => record(ledger, { utc: new Date().toISOString(), usd: intent.usd, prompt: ask.prompt }),
      });
      const request = {
        action: 'sign_transaction_request',
        time: 0,
        sequence: ++sequence,
        transaction: { transaction: r.tx, sourceOutputs: relaySourceOutputs(r), broadcast: false, userPrompt: r.userPrompt },
        inputPaths: toWizardInputPaths(r.inputPaths),
      } as unknown as SignTransactionRequest;
      // The relay carries JSON: round-trip it the way the wallet receives it.
      return (await adapter.signTransaction(JSON.parse(JSON.stringify(request)) as SignTransactionRequest)).signedTransaction;
    },
  };
  const view = await scanWallet(api, session, 'bitcoincash', { gapLimit: config.wallet.gapLimit, maxRounds: 3 });
  const run = runSwap({
    api,
    session,
    wallet: view,
    intent: { token: 'PUSD', ...trade, minReceive: BigInt(quote.minReceive), category: PUSD, feeCapSats: BigInt(config.fees.capSats), userPrompt: 'Swap 0.001 BCH', business: config.business },
  });
  return { run, ledger };
}

const intentOk = (min: bigint, usd = 0.5): Intent => ({ spend: { sats: '100000' }, receive: { category: PUSD, min: min.toString() }, usd });

describe('test wallet', { timeout: 30_000 }, () => {
  it('signs a swap that matches its intent and records the spend', async () => {
    const { run, ledger } = await swapThroughTestWallet((min) => intentOk(min));
    await expect(run).resolves.toMatchObject({ txid: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const lines = readFileSync(ledger, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ usd: 0.5, prompt: 'Swap 0.001 BCH' });
  });

  it('signs a sell to BCH: the BCH category is not lowercased into a token id', async () => {
    const sell = (min: bigint): Intent => ({ spend: { sats: '0', tokens: { [PUSD]: '100' } }, receive: { category: BCH, min: min.toString() }, usd: 1 });
    const { run } = await swapThroughTestWallet(sell, 0, { side: 'sell', amount: 100n });
    await expect(run).resolves.toMatchObject({ txid: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it('refuses when the transaction pays less than the intent expects', async () => {
    const { run, ledger } = await swapThroughTestWallet((min) => intentOk(min * 2n));
    await expect(run).rejects.toThrow(/refused: checkTransaction rule 4/);
    expect(spentOn(ledger, new Date().toISOString().slice(0, 10))).toBe(0);
  });

  it('refuses when more BCH would leave than the intent says', async () => {
    const { run } = await swapThroughTestWallet((min) => ({ ...intentOk(min), spend: { sats: '50000' } }));
    await expect(run).rejects.toThrow(/refused: checkTransaction rule 2/);
  });

  it('refuses above the per-transaction limit', async () => {
    const { run } = await swapThroughTestWallet((min) => intentOk(min, budget.maxUsdPerTx + 0.01));
    await expect(run).rejects.toThrow(/per-transaction limit/);
  });

  it('refuses when the day would pass its limit', async () => {
    const { run } = await swapThroughTestWallet((min) => intentOk(min, 1), budget.maxUsdPerDay - 0.5);
    await expect(run).rejects.toThrow(/daily limit/);
  });
});

describe('test wallet paying a landing address', () => {
  const params = { ownerLockHex: `76a914${'11'.repeat(20)}88ac`, category: PUSD, rateNum: 1n, rateDen: LANDING_RATE_DEN, returnAfter: 6 };
  const landingLock = landingLockingHex(params);
  const own = deriveAddress(keys.publicKey('receive', 0), 'receive', 0, 'bitcoincash');
  const pay = buildPayment({
    coins: [{ txid: 'ab'.repeat(32), vout: 0, sats: 500_000n, lockingHex: own.lockingHex, path: 'receive/0', hasToken: false }],
    toLockingHex: landingLock,
    sats: 100_000n,
    changeLockingHex: own.lockingHex,
    satsPerByte: 1n,
  });
  const ask = { tx: txToHex(pay.transaction), sourceOutputs: pay.sourceOutputs.map(outputToWire), inputPaths: pay.inputPaths };
  const ctx = (intent: Intent) => ({ ownLocks: [own.lockingHex], intent, budget, spentTodayUsd: 0, feeCapSats: BigInt(config.fees.capSats) });
  const base: Intent = { spend: { sats: '100000' }, receive: { category: PUSD, min: '0' }, usd: 0.2 };

  it('signs a payment to the landing address the page showed', () => {
    expect(review(ask, ctx({ ...base, deposits: [{ lockingBytecode: landingLock.toUpperCase(), sats: '100000' }] }))).toEqual({ ok: true });
  });

  it('refuses a payment to an address the page did not show, or another amount', () => {
    expect(review(ask, ctx(base))).toMatchObject({ ok: false });
    expect(review(ask, ctx({ ...base, deposits: [{ lockingBytecode: landingLock, sats: '99999' }] }))).toMatchObject({ ok: false });
  });
});
