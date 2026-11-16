import { binToHex, encodeLockingBytecodeP2pkh, hash160, lockingBytecodeToCashAddress, secp256k1, sha256 } from '@bitauth/libauth';
import { beforeEach, describe, expect, it } from 'vitest';
import { PUSD, pools, userLock } from '../../tests/helpers/pools.js';
import type { SampanConfig } from '../../core/config.js';
import { LANDING_RATE_DEN, landingLockingHex, minTokensFor, type LandingParams } from '../../core/landing.js';
import { invoiceRate, requiredSatsFor } from '../../core/pay/quote.js';
import { poolV0LockingHex } from '../../core/pools/template.js';
import { selectTrade } from '../../core/pools/trade.js';
import { FakeChain } from '../chain/fake.js';
import { finishLanding, type FinishDeps } from '../landing/finish.js';
import { refreshPools } from '../pools.js';
import { FeeWallet, feeWalletFrom, isInvoiceLanding } from './spread.js';

const keyOf = (seed: string) => sha256.hash(new TextEncoder().encode(seed));
const lockOf = (key: Uint8Array) => encodeLockingBytecodeP2pkh(hash160(secp256k1.derivePublicKeyCompressed(key) as Uint8Array));
const addressOf = (key: Uint8Array) => {
  const a = lockingBytecodeToCashAddress({ prefix: 'bitcoincash', bytecode: lockOf(key) });
  if (typeof a === 'string') throw new Error(a);
  return a.address;
};
const FEE_KEY = keyOf('sampan fee wallet in a finisher test');
const FEE_LOCK = binToHex(lockOf(FEE_KEY));
const TOKENS = 20n;
const tradeSats = selectTrade(pools, PUSD, { side: 'buy', target: 'demand', amount: TOKENS, maxPools: 3, satsPerByte: 1n }).supply;
const SATS = requiredSatsFor({ tradeSats, bufferBps: 100, convertFeeSats: 700, tokenDustSats: 1000, spreadBps: 50 });
const INVOICE: LandingParams = { ownerLockHex: binToHex(userLock), category: PUSD, ...invoiceRate(TOKENS, SATS, 77), returnAfter: 6 };

let chain: FakeChain;
const deps = (over: Partial<FinishDeps> = {}): FinishDeps => ({
  chain,
  loadPools: () => refreshPools(chain, pools),
  maxPools: 3,
  satsPerByte: 1n,
  tokenDustSats: 1000n,
  attempts: 3,
  ...over,
});
const owner = async () => (await chain.listUnspent(binToHex(userLock))).reduce((s, u) => s + (u.token?.amount ?? 0n), 0n);
const atFee = async () => (await chain.listUnspent(FEE_LOCK)).reduce((s, u) => s + u.sats, 0n);

beforeEach(() => {
  chain = new FakeChain();
  for (const p of pools) chain.add(poolV0LockingHex(p.ownerPkh), { txid: p.txid, vout: p.vout, sats: p.sats, height: 1, token: { category: PUSD, amount: p.tokens } });
  chain.add(landingLockingHex(INVOICE), { txid: 'ab'.repeat(32), vout: 0, sats: SATS, height: 0 });
});

describe('finishLanding with the fee wallet', () => {
  it('pays the merchant the invoice floor and keeps the rest at the fee address', async () => {
    chain.add(FEE_LOCK, { txid: 'cd'.repeat(32), vout: 0, sats: 3_000n, height: 1 });
    const [r] = await finishLanding(INVOICE, deps({ spread: new FeeWallet(chain, FEE_KEY, addressOf(FEE_KEY)) }));
    if (r?.action !== 'converted') throw new Error(`not converted: ${JSON.stringify(r, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))}`);
    expect(r.tokens).toBe(minTokensFor(INVOICE, SATS));
    expect(await owner()).toBe(TOKENS);
    expect(r.spreadSats).toBeGreaterThan(0n);
    expect(await atFee()).toBe(3_000n + r.spreadSats!);
  });

  it('chains the fee coin: a second invoice payment spends the output of the first', async () => {
    chain.add(FEE_LOCK, { txid: 'cd'.repeat(32), vout: 0, sats: 3_000n, height: 1 });
    chain.add(landingLockingHex(INVOICE), { txid: 'ef'.repeat(32), vout: 0, sats: SATS, height: 0 });
    const results = await finishLanding(INVOICE, deps({ spread: new FeeWallet(chain, FEE_KEY, addressOf(FEE_KEY)) }));
    expect(results.map((r) => r.action)).toEqual(['converted', 'converted']);
    expect(await chain.listUnspent(FEE_LOCK)).toHaveLength(1);
  });

  it('without a fee coin converts the whole payment for the merchant, as before', async () => {
    const [r] = await finishLanding(INVOICE, deps({ spread: new FeeWallet(chain, FEE_KEY, addressOf(FEE_KEY)) }));
    if (r?.action !== 'converted') throw new Error(`not converted: ${JSON.stringify(r, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))}`);
    expect(r.spreadSats).toBeUndefined();
    // PUSD trades in whole cents, so what the trade cannot use stays with the merchant as BCH on the token output.
    expect(await owner()).toBeGreaterThanOrEqual(TOKENS);
    const merchantSats = (await chain.listUnspent(binToHex(userLock))).reduce((s, u) => s + u.sats, 0n);
    expect(merchantSats).toBeGreaterThan(1000n);
    expect(await atFee()).toBe(0n);
  });
});

describe('fee wallet setup', () => {
  const config = (spreadBps: number, feeAddress = addressOf(FEE_KEY)) => ({ pay: { spreadBps }, business: { feeAddress } }) as unknown as SampanConfig;

  it('loads no key while the spread is 0, even when one is given', () => {
    expect(feeWalletFrom(config(0), chain, binToHex(FEE_KEY))).toBeNull();
  });

  it('refuses to run a spread without the key, or with a key of another address', () => {
    expect(() => feeWalletFrom(config(50), chain, undefined)).toThrow(/SAMPAN_SPREAD_KEY/);
    expect(() => feeWalletFrom(config(50, addressOf(keyOf('someone else'))), chain, binToHex(FEE_KEY))).toThrow(/does not belong/);
    expect(feeWalletFrom(config(50), chain, binToHex(FEE_KEY))?.feeLockHex).toBe(FEE_LOCK);
  });

  it('applies the spread to invoice addresses only', () => {
    expect(isInvoiceLanding(INVOICE)).toBe(true);
    expect(isInvoiceLanding({ rateDen: LANDING_RATE_DEN })).toBe(false);
  });
});
