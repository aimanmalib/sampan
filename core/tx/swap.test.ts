import { binToHex, hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { PUSD, coin, otherKey, pools, testKey, userLock } from '../../tests/helpers/pools.js';
import { signP2pkhInputs } from './sign.js';
import { poolV0LockingBytecode } from '../pools/template.js';
import { selectTrade } from '../pools/trade.js';
import { buildSwapTx, SwapBuildError } from './swap.js';
import { verifyInputs, verifyTransaction } from './verify.js';

const buyTrade = () => selectTrade(pools, PUSD, { side: 'buy', target: 'supply', amount: 1_000_000n, maxPools: 3, satsPerByte: 1n });
const sellTrade = () => selectTrade(pools, PUSD, { side: 'sell', target: 'supply', amount: 300n, maxPools: 2, satsPerByte: 1n });
const base = { payoutLockingBytecode: userLock, changeLockingBytecode: userLock, satsPerByte: 1n, tokenDustSats: 1000n };

describe('buildSwapTx', () => {
  it('buy: pools first at matching indexes, version 2, passes the VM once signed', () => {
    const trade = buyTrade();
    const built = buildSwapTx({ ...base, trade, coins: [coin(0, 2_000_000n)] });
    const { transaction: tx, sourceOutputs } = built;
    const n = trade.legs.length;
    expect(tx.version).toBe(2);
    expect(tx.locktime).toBe(0);
    for (let i = 0; i < n; i++) {
      expect(binToHex(tx.outputs[i]!.lockingBytecode)).toBe(binToHex(sourceOutputs[i]!.lockingBytecode));
      expect(binToHex(tx.outputs[i]!.lockingBytecode)).toBe(binToHex(poolV0LockingBytecode(hexToBin(trade.legs[i]!.pool.ownerPkh))));
    }
    expect(built.userInputIndexes).toEqual([n]);
    expect(tx.outputs[n]!.token!.amount).toBe(trade.demand);
    expect(tx.outputs[n]!.valueSatoshis).toBe(1000n);
    expect(verifyInputs(tx, sourceOutputs, [...Array(n).keys()])).toEqual({ ok: true });
    const signed = signP2pkhInputs(tx, sourceOutputs, built.userInputIndexes, testKey);
    expect(verifyTransaction(signed, sourceOutputs)).toEqual({ ok: true });
    expect(built.feeSats).toBe(BigInt(built.sizeBytes));
    expect(built.feeSats).toBeGreaterThanOrEqual(BigInt(signed.inputs.length * 100));
  });

  it('sell: BCH proceeds and token change go back to the user and the VM accepts it', () => {
    const trade = sellTrade();
    const built = buildSwapTx({ ...base, trade, coins: [coin(0, 2_000n, 1_000n)] });
    const n = trade.legs.length;
    const outs = built.transaction.outputs;
    expect(outs[n]!.token).toBeUndefined();
    expect(outs[n + 1]!.token!.amount).toBe(1_000n - trade.supply);
    const signed = signP2pkhInputs(built.transaction, built.sourceOutputs, built.userInputIndexes, testKey);
    expect(verifyTransaction(signed, built.sourceOutputs)).toEqual({ ok: true });
  });

  it('sabotage: one token more from a pool fails the pool contract in the VM', () => {
    const trade = buyTrade();
    const built = buildSwapTx({ ...base, trade, coins: [coin(0, 2_000_000n)] });
    const tx = structuredClone(built.transaction);
    const out0 = tx.outputs[0]!;
    out0.token = { ...out0.token!, amount: out0.token!.amount - 1n };
    expect(verifyInputs(tx, built.sourceOutputs, [0]).ok).toBe(false);
  });

  it('sabotage: a signature from the wrong key fails the VM', () => {
    const built = buildSwapTx({ ...base, trade: buyTrade(), coins: [coin(0, 2_000_000n)] });
    const signed = signP2pkhInputs(built.transaction, built.sourceOutputs, built.userInputIndexes, otherKey);
    expect(verifyTransaction(signed, built.sourceOutputs).ok).toBe(false);
  });

  it('refuses when the coins cannot pay for the swap', () => {
    expect(() => buildSwapTx({ ...base, trade: buyTrade(), coins: [coin(0, 500_000n)] })).toThrow(SwapBuildError);
    expect(() => buildSwapTx({ ...base, trade: sellTrade(), coins: [coin(0, 2_000n, 10n)] })).toThrow(SwapBuildError);
  });
});
