import { binToHex } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { PUSD, pools, userLock } from '../../tests/helpers/pools.js';
import { GIVE_BACK_MAX_FEE_SATS, LANDING_RATE_DEN, landingLockingHex, minTokensFor, rateNumFor, type LandingParams } from '../landing.js';
import { selectTrade } from '../pools/trade.js';
import { buildConvertTx, buildGiveBackTx, LandingBuildError, planConvert } from './landing.js';
import { verifyTransaction } from './verify.js';

const COIN = { txid: '11'.repeat(32), vout: 0, sats: 100_000n };
const DUST = 1000n;
// A minimum 3% under what the captured pools pay for this coin, the way the server sets it.
const quoted = selectTrade(pools, PUSD, { side: 'buy', target: 'supply', amount: COIN.sats - DUST - 400n, maxPools: 3, satsPerByte: 1n }).demand;
const PARAMS: LandingParams = {
  ownerLockHex: binToHex(userLock),
  category: PUSD,
  rateNum: rateNumFor((quoted * 97n) / 100n, COIN.sats),
  rateDen: LANDING_RATE_DEN,
  returnAfter: 6,
};
const plan = { params: PARAMS, coin: COIN, pools, maxPools: 3, satsPerByte: 1n, tokenDustSats: DUST };

describe('planConvert', () => {
  it('builds a convert that the VM accepts with no signature at all', () => {
    const built = planConvert(plan);
    const { transaction: tx, sourceOutputs } = built;
    expect(binToHex(sourceOutputs[0]!.lockingBytecode)).toBe(landingLockingHex(PARAMS));
    expect(tx.outputs).toHaveLength(tx.inputs.length);
    expect(binToHex(tx.outputs[0]!.lockingBytecode)).toBe(binToHex(userLock));
    expect(tx.outputs[0]!.token!.amount).toBeGreaterThanOrEqual(minTokensFor(PARAMS, COIN.sats));
    expect(built.userInputIndexes).toEqual([]);
    expect(built.feeSats).toBe(BigInt(built.sizeBytes));
    // Satoshis the whole-unit trade could not use stay with the owner.
    const poolsIn = built.sourceOutputs.slice(1).reduce((s, o) => s + o.valueSatoshis, 0n);
    const poolsOut = tx.outputs.slice(1).reduce((s, o) => s + o.valueSatoshis, 0n);
    expect(tx.outputs[0]!.valueSatoshis).toBe(COIN.sats - (poolsOut - poolsIn) - built.feeSats);
    expect(tx.outputs[0]!.valueSatoshis).toBeGreaterThanOrEqual(DUST);
    expect(verifyTransaction(tx, sourceOutputs)).toEqual({ ok: true });
  });

  it('refuses when the pools pay less than the contract minimum', () => {
    const impossible = { ...PARAMS, rateNum: rateNumFor(quoted * 2n, COIN.sats) };
    expect(() => planConvert({ ...plan, params: impossible })).toThrow(LandingBuildError);
  });

  it('the builder refuses a trade one base unit under a tighter minimum', () => {
    const built = planConvert(plan);
    const paid = built.transaction.outputs[0]!.token!.amount;
    const tight = { ...PARAMS, rateNum: rateNumFor(paid + 1n, COIN.sats) };
    // Same transaction shape, but a contract whose minimum is above what the trade pays.
    const trade = selectTrade(pools, PUSD, { side: 'buy', target: 'supply', amount: COIN.sats - DUST - built.feeSats, maxPools: 3, satsPerByte: 1n });
    expect(() => buildConvertTx({ params: tight, coin: COIN, trade, satsPerByte: 1n, tokenDustSats: DUST })).toThrow(/contract needs at least/);
  });

  it('reports the fee it needs when the trade leaves too little for the miner', () => {
    const trade = selectTrade(pools, PUSD, { side: 'buy', target: 'supply', amount: COIN.sats - DUST, maxPools: 1, satsPerByte: 1n });
    const left = COIN.sats - trade.supply;
    try {
      buildConvertTx({ params: PARAMS, coin: COIN, trade, satsPerByte: 1n, tokenDustSats: left });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LandingBuildError);
      expect((e as LandingBuildError).neededFeeSats).toBeGreaterThan(0n);
    }
  });
});

describe('buildGiveBackTx', () => {
  it('returns the coin to the owner with the relative lock in the sequence and passes the VM', () => {
    const built = buildGiveBackTx(PARAMS, COIN, 1n);
    const tx = built.transaction;
    expect(tx.version).toBe(2);
    expect(tx.inputs[0]!.sequenceNumber).toBe(PARAMS.returnAfter);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputs[0]!.token).toBeUndefined();
    expect(tx.outputs[0]!.valueSatoshis).toBe(COIN.sats - built.feeSats);
    expect(built.feeSats).toBeLessThanOrEqual(GIVE_BACK_MAX_FEE_SATS);
    expect(verifyTransaction(tx, built.sourceOutputs)).toEqual({ ok: true });
  });

  it('the VM rejects it when the sequence is below returnAfter', () => {
    const built = buildGiveBackTx(PARAMS, COIN, 1n);
    const early = { ...built.transaction, inputs: [{ ...built.transaction.inputs[0]!, sequenceNumber: PARAMS.returnAfter - 1 }] };
    expect(verifyTransaction(early, built.sourceOutputs).ok).toBe(false);
  });

  it('refuses a fee rate that would keep more than the contract allows', () => {
    expect(() => buildGiveBackTx(PARAMS, COIN, 10n)).toThrow(LandingBuildError);
  });
});
