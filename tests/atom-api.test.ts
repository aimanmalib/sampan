// POST /api/atom/broadcast on the fake network: closed while the atom flag or the PUSD to USDC flow is off, refuses a
// transaction that is not one payment of the route stablecoin to a P2SH32 contract or that fails the VM, and relays a
// signed payment built and checked as the page does.
import { hexToBin } from '@bitauth/libauth';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { signP2pkhInputs } from '../core/tx/sign.js';
import { buildTokenPayment } from '../core/tx/token-payment.js';
import { outputToWire, txToHex } from '../core/wire.js';
import { buildApp } from '../server/app.js';
import { contractPaymentProblem } from '../server/api/atom.js';
import type { FakeChain } from '../server/chain/fake.js';
import { createServices } from '../server/services.js';
import { PUSD, testKey } from './helpers/pools.js';
import { userLockHex } from './helpers/wallet.js';

const base = normalizeConfig(shipped as unknown as SampanConfig);
const on = (flows: string[]) => patchConfig(base, JSON.stringify({ features: { atom: true }, atom: { flows }, rate: { quotesPerMinute: 1000, crossingsPerHour: 1000 } }));
const CONTRACT = `aa20${'5c'.repeat(32)}87`;
let app: FastifyInstance | undefined;
let dist: string | undefined;

async function start(c: SampanConfig, coins = true) {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-atom-'));
  const services = createServices({ config: c, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  if (coins) {
    const chain = services.chain as FakeChain;
    chain.add(userLockHex, { txid: 'cd'.repeat(32), vout: 0, sats: 1000n, height: 1, token: { category: PUSD, amount: 3_000_000n } });
    chain.add(userLockHex, { txid: 'cd'.repeat(32), vout: 1, sats: 50_000n, height: 1 });
  }
  app = await buildApp({ config: c, webDist: dist, fake: true, services, startWatcher: false });
  return app;
}
afterEach(async () => {
  await app?.close();
  app = undefined;
  if (dist) rmSync(dist, { recursive: true, force: true });
});

function payment(to = CONTRACT, category = PUSD) {
  const p = buildTokenPayment({
    coins: [
      { txid: 'cd'.repeat(32), vout: 0, sats: 1000n, lockingHex: userLockHex, path: 'receive/0', token: { category: PUSD, amount: 3_000_000n, nft: false } },
      { txid: 'cd'.repeat(32), vout: 1, sats: 50_000n, lockingHex: userLockHex, path: 'receive/0' },
    ],
    to: { lockingHex: to, sats: 2000n, category, amount: 2_000_000n },
    tokenChangeLockingHex: userLockHex,
    tokenDustSats: 1000n,
    changeLockingHex: userLockHex,
    satsPerByte: 1n,
  });
  const signed = signP2pkhInputs(p.transaction, p.sourceOutputs, [0, 1], testKey);
  return { tx: txToHex(signed), unsigned: txToHex(p.transaction), sourceOutputs: p.sourceOutputs.map(outputToWire) };
}

const post = (a: FastifyInstance, body: unknown) => a.inject({ method: 'POST', url: '/api/atom/broadcast', payload: body as Record<string, unknown> });

describe('atom contract payment relay', { timeout: 30_000 }, () => {
  it('is closed while the flag is off', async () => {
    const p = payment();
    const res = await post(await start(base), { tx: p.tx, sourceOutputs: p.sourceOutputs });
    expect([res.statusCode, res.json()]).toMatchObject([404, { error: 'flow_closed' }]);
  });

  it('is closed while only USDC to PUSD is offered', async () => {
    const p = payment();
    expect((await post(await start(on(['usdc-to-pusd'])), { tx: p.tx, sourceOutputs: p.sourceOutputs })).json()).toMatchObject({ error: 'flow_closed' });
  });

  it('refuses a payment that is not one stablecoin output to a P2SH32 contract, or that fails the VM', async () => {
    const a = await start(on(['pusd-to-usdc']));
    const toWallet = payment(userLockHex);
    expect((await post(a, { tx: toWallet.tx, sourceOutputs: toWallet.sourceOutputs })).json()).toMatchObject({ error: 'not_contract_payment' });
    const unsigned = payment();
    expect((await post(a, { tx: unsigned.unsigned, sourceOutputs: unsigned.sourceOutputs })).json()).toMatchObject({ error: 'invalid_transaction' });
    expect(contractPaymentProblem([{ lockingBytecode: hexToBin(CONTRACT), token: { category: hexToBin('ee'.repeat(32)) } }], PUSD)).toMatch(/route stablecoin/);
    expect(contractPaymentProblem([{ lockingBytecode: hexToBin(CONTRACT), token: { category: hexToBin(PUSD) } }, { lockingBytecode: hexToBin(CONTRACT) }], PUSD)).toMatch(/exactly one/);
    expect(contractPaymentProblem([{ lockingBytecode: hexToBin(CONTRACT), token: { category: hexToBin(PUSD) } }, { lockingBytecode: hexToBin('6a00') }], PUSD)).toMatch(/plain wallet/);
  });

  it('relays a signed payment and the contract output appears on the chain', async () => {
    const a = await start(on(['pusd-to-usdc']));
    const p = payment();
    const res = await post(a, { tx: p.tx, sourceOutputs: p.sourceOutputs });
    expect(res.statusCode).toBe(200);
    const { txid } = res.json() as { txid: string };
    expect(txid).toMatch(/^[0-9a-f]{64}$/);
    const again = await post(a, { tx: p.tx, sourceOutputs: p.sourceOutputs });
    expect(again.json()).toMatchObject({ error: 'stale_inputs' });
  });
});
