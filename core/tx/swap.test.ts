import { binToHex, encodeTransaction, hexToBin, sha256 } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { PUSD, coin, otherKey, otherLock, pools, testKey, userLock } from '../../tests/helpers/pools.js';
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

  // Bytes of these two fixture swaps before the Sampan fee existed (sha256 of the encoded transaction).
  const GOLDEN = {
    buy: '9bfbba0115d342e0fcfc536f8258c29d0115c7356b41959d9a728b5dcbd7ad2f',
    sell: '6e9e2a8f8e255587a07625026e4bcc86ae7f36b9c8456276b9f78799e86a237a',
  };
  const digest = (b: { transaction: Parameters<typeof encodeTransaction>[0] }): string => binToHex(sha256.hash(encodeTransaction(b.transaction)));

  it('golden: no fee, or a fee of 0, builds the same bytes as before the fee existed', () => {
    const coinsBuy = [coin(0, 2_000_000n)];
    const coinsSell = [coin(0, 2_000n, 1_000n)];
    expect(digest(buildSwapTx({ ...base, trade: buyTrade(), coins: coinsBuy }))).toBe(GOLDEN.buy);
    expect(digest(buildSwapTx({ ...base, trade: sellTrade(), coins: coinsSell }))).toBe(GOLDEN.sell);
    const zero = { sampanFee: { lockingBytecode: otherLock, sats: 0n } };
    expect(digest(buildSwapTx({ ...base, ...zero, trade: buyTrade(), coins: coinsBuy }))).toBe(GOLDEN.buy);
    expect(digest(buildSwapTx({ ...base, ...zero, trade: sellTrade(), coins: coinsSell }))).toBe(GOLDEN.sell);
  });

  it('fee: one plain output last, paid from the change (buy) or the proceeds (sell), and the VM accepts it', () => {
    const sampanFee = { lockingBytecode: otherLock, sats: 3_000n };
    for (const [trade, coins] of [
      [buyTrade(), [coin(0, 2_000_000n)]],
      [sellTrade(), [coin(0, 2_000n, 1_000n)]],
    ] as const) {
      const plain = buildSwapTx({ ...base, trade, coins: [...coins] });
      const withFee = buildSwapTx({ ...base, trade, coins: [...coins], sampanFee });
      const outs = withFee.transaction.outputs;
      const last = outs[outs.length - 1]!;
      expect(binToHex(last.lockingBytecode)).toBe(binToHex(otherLock));
      expect(last.valueSatoshis).toBe(3_000n);
      expect(last.token).toBeUndefined();
      expect(outs.length).toBe(plain.transaction.outputs.length + 1);
      const userSats = (b: typeof plain): bigint =>
        b.transaction.outputs.filter((o) => binToHex(o.lockingBytecode) === binToHex(userLock)).reduce((a, o) => a + o.valueSatoshis, 0n);
      // The user gets the fee less, give or take the network fee of the 34-byte extra output.
      expect(userSats(plain) - userSats(withFee) - 3_000n).toBe(withFee.feeSats - plain.feeSats);
      const signed = signP2pkhInputs(withFee.transaction, withFee.sourceOutputs, withFee.userInputIndexes, testKey);
      expect(verifyTransaction(signed, withFee.sourceOutputs)).toEqual({ ok: true });
    }
  });
});

