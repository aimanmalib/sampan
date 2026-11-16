import { binToHex, encodeLockingBytecodeP2pkh, encodeTransaction, hash160, secp256k1, sha256 } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { PUSD, pools, userLock } from '../../tests/helpers/pools.js';
import { LANDING_RATE_DEN, minTokensFor, rateNumFor, type LandingParams } from '../landing.js';
import { invoiceRate, requiredSatsFor } from '../pay/quote.js';
import { selectTrade } from '../pools/trade.js';
import { LandingBuildError, planConvert } from './landing.js';
import { signP2pkhInputs } from './sign.js';
import { planSpreadConvert, spreadOf } from './spread.js';
import { verifyTransaction } from './verify.js';

const FEE_KEY = sha256.hash(new TextEncoder().encode('sampan spread fee wallet'));
const FEE_LOCK = binToHex(encodeLockingBytecodeP2pkh(hash160(secp256k1.derivePublicKeyCompressed(FEE_KEY) as Uint8Array)));
const FEE_COIN = { txid: '22'.repeat(32), vout: 1, sats: 5_000n, lockHex: FEE_LOCK };
const DUST = 1000n;
const TOKENS = 20n; // 0.20 PUSD
const tradeSats = selectTrade(pools, PUSD, { side: 'buy', target: 'demand', amount: TOKENS, maxPools: 3, satsPerByte: 1n }).supply;
const invoice = (spreadBps: number) => {
  const sats = requiredSatsFor({ tradeSats, bufferBps: 100, convertFeeSats: 700, tokenDustSats: 1000, spreadBps });
  const params: LandingParams = { ownerLockHex: binToHex(userLock), category: PUSD, ...invoiceRate(TOKENS, sats, 4242), returnAfter: 6 };
  return { params, coin: { txid: '11'.repeat(32), vout: 0, sats } };
};
const plan = (spreadBps: number) => ({ ...invoice(spreadBps), pools, maxPools: 3, satsPerByte: 1n, tokenDustSats: DUST, feeCoin: FEE_COIN, feeLockHex: FEE_LOCK });

describe('planSpreadConvert', () => {
  it('pays the owner exactly the invoice floor and the fee address its coin plus the rest', () => {
    const o = plan(50);
    const built = planSpreadConvert(o);
    const tx = { ...built.transaction, ...{ inputs: signP2pkhInputs(built.transaction, built.sourceOutputs, built.userInputIndexes, FEE_KEY).inputs } };
    expect(minTokensFor(o.params, o.coin.sats)).toBe(TOKENS);
    expect(tx.outputs[0]!.token!.amount).toBe(TOKENS);
    expect(tx.outputs[0]!.valueSatoshis).toBe(DUST);
    expect(tx.outputs).toHaveLength(tx.inputs.length);
    expect(built.userInputIndexes).toEqual([tx.inputs.length - 1]);
    expect(binToHex(tx.outputs.at(-1)!.lockingBytecode)).toBe(FEE_LOCK);
    // The spread at least covers what the payer was asked on top of the trade; nothing is lost between in and out.
    expect(spreadOf(built)).toBeGreaterThanOrEqual((tradeSats * 50n) / 10_000n);
    const satsIn = built.sourceOutputs.reduce((s, x) => s + x.valueSatoshis, 0n);
    const satsOut = tx.outputs.reduce((s, x) => s + x.valueSatoshis, 0n);
    expect(satsIn - satsOut).toBe(built.feeSats);
    // The signed size is the size the fee was paid for.
    expect(encodeTransaction(tx).length).toBe(built.sizeBytes);
    expect(verifyTransaction(tx, built.sourceOutputs)).toEqual({ ok: true });
  });

  it('refuses a coin that cannot pay the floor trade, the fee and the dust', () => {
    const o = plan(50);
    const short = { ...o, coin: { ...o.coin, sats: tradeSats + DUST } };
    // Same floor as the invoice: the rate is the invoice's, only the coin is smaller.
    expect(() => planSpreadConvert({ ...short, params: { ...o.params, rateNum: rateNumFor(TOKENS, short.coin.sats) } })).toThrow(LandingBuildError);
  });
});

describe('spreadBps 0 changes nothing', () => {
  it('asks the same satoshis as before the spread existed', () => {
    const before = requiredSatsFor({ tradeSats, bufferBps: 100, convertFeeSats: 700, tokenDustSats: 1000 });
    expect(requiredSatsFor({ tradeSats, bufferBps: 100, convertFeeSats: 700, tokenDustSats: 1000, spreadBps: 0 })).toBe(before);
    expect(requiredSatsFor({ tradeSats: 50_000n, bufferBps: 0, convertFeeSats: 0, tokenDustSats: 0, spreadBps: 50 })).toBe(50_250n);
  });

  it('builds the ordinary convert byte for byte (golden, captured before the spread was added)', () => {
    const COIN = { txid: '11'.repeat(32), vout: 0, sats: 100_000n };
    const quoted = selectTrade(pools, PUSD, { side: 'buy', target: 'supply', amount: COIN.sats - DUST - 400n, maxPools: 3, satsPerByte: 1n }).demand;
    const params: LandingParams = { ownerLockHex: binToHex(userLock), category: PUSD, rateNum: rateNumFor((quoted * 97n) / 100n, COIN.sats), rateDen: LANDING_RATE_DEN + 4242n, returnAfter: 6 };
    const hex = binToHex(encodeTransaction(planConvert({ params, coin: COIN, pools, maxPools: 3, satsPerByte: 1n, tokenDustSats: DUST }).transaction));
    expect(binToHex(sha256.hash(new TextEncoder().encode(`${hex}\n`)))).toBe('93a1f9372f7184875cb130615b6682deb4ffa1af1157a56d7773f31d0c9fe499');
  });
});
