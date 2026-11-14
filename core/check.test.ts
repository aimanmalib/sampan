import { binToHex, hexToBin, type Output } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { PUSD, coin, otherLock, pools, userLock } from '../tests/helpers/pools.js';
import { BCH, checkTransaction, type Expectation } from './check.js';
import { selectTrade } from './pools/trade.js';
import { buildSwapTx } from './tx/swap.js';
import type { BuiltTx, Tx } from './tx/types.js';

const FEE_CAP = 5_000n;
const base = { payoutLockingBytecode: userLock, changeLockingBytecode: userLock, satsPerByte: 1n, tokenDustSats: 1000n };

const buy = (): { built: BuiltTx; e: Expectation } => {
  const trade = selectTrade(pools, PUSD, { side: 'buy', target: 'supply', amount: 1_000_000n, maxPools: 3, satsPerByte: 1n });
  const built = buildSwapTx({ ...base, trade, coins: [coin(0, 2_000_000n), coin(1, 30_000n)] });
  const e: Expectation = {
    userLockingBytecodes: [binToHex(userLock)],
    inputPaths: built.userInputIndexes.map((inputIndex, k) => ({ inputIndex, path: `0/${k}` })),
    poolOwnerPkhs: trade.legs.map((l) => l.pool.ownerPkh),
    spend: { sats: trade.supply, tokens: {} },
    feeCapSats: FEE_CAP,
    receive: { category: PUSD, min: trade.demand },
  };
  return { built, e };
};

const sell = (): { built: BuiltTx; e: Expectation } => {
  const trade = selectTrade(pools, PUSD, { side: 'sell', target: 'supply', amount: 300n, maxPools: 2, satsPerByte: 1n });
  const built = buildSwapTx({ ...base, trade, coins: [coin(0, 2_000n, 1_000n)] });
  const e: Expectation = {
    userLockingBytecodes: [binToHex(userLock)],
    inputPaths: built.userInputIndexes.map((inputIndex) => ({ inputIndex, path: '0/0' })),
    poolOwnerPkhs: trade.legs.map((l) => l.pool.ownerPkh),
    spend: { sats: 0n, tokens: { [PUSD]: trade.supply } },
    feeCapSats: FEE_CAP,
    receive: { category: BCH, min: trade.demand - built.feeSats },
  };
  return { built, e };
};

const run = (tx: Tx, src: Output[], e: Expectation) => checkTransaction(tx, src, e);
const ruleOf = (r: ReturnType<typeof checkTransaction>): number | undefined => (r.ok ? undefined : r.rule);

describe('checkTransaction', () => {
  it('accepts an honest buy and an honest sell', () => {
    const b = buy();
    expect(run(b.built.transaction, b.built.sourceOutputs, b.e)).toEqual({ ok: true });
    const s = sell();
    expect(run(s.built.transaction, s.built.sourceOutputs, s.e)).toEqual({ ok: true });
  });

  it('rule 1: an extra output to a foreign address is refused', () => {
    const { built, e } = buy();
    const tx = structuredClone(built.transaction);
    tx.outputs.push({ lockingBytecode: otherLock, valueSatoshis: 1000n });
    expect(ruleOf(run(tx, built.sourceOutputs, e))).toBe(1);
  });

  it('rule 1: change redirected to a foreign address is refused', () => {
    const { built, e } = buy();
    const tx = structuredClone(built.transaction);
    tx.outputs[tx.outputs.length - 1]!.lockingBytecode = otherLock;
    expect(ruleOf(run(tx, built.sourceOutputs, e))).toBe(1);
  });

  it('rule 2: spending more BCH than shown is refused', () => {
    const { built, e } = buy();
    expect(ruleOf(run(built.transaction, built.sourceOutputs, { ...e, spend: { sats: e.spend.sats - FEE_CAP - 1n, tokens: {} } }))).toBe(2);
  });

  it('rule 2: a fee above the cap is refused', () => {
    const { built, e } = buy();
    const tx = structuredClone(built.transaction);
    const last = tx.outputs[tx.outputs.length - 1]!;
    last.valueSatoshis -= FEE_CAP;
    expect(ruleOf(run(tx, built.sourceOutputs, e))).toBe(2);
  });

  it('rule 2: spending more tokens than shown is refused', () => {
    const { built, e } = sell();
    expect(ruleOf(run(built.transaction, built.sourceOutputs, { ...e, spend: { sats: 0n, tokens: { [PUSD]: 1n } } }))).toBe(2);
  });

  it('rule 3: a deposit output with the wrong amount or a token is refused, a missing one too', () => {
    const { built, e } = buy();
    const tx = structuredClone(built.transaction);
    const deposit = { lockingBytecode: binToHex(otherLock), sats: 5000n };
    tx.outputs.push({ lockingBytecode: otherLock, valueSatoshis: 4999n });
    const spend = { sats: e.spend.sats + 5000n, tokens: {} };
    expect(ruleOf(run(tx, built.sourceOutputs, { ...e, spend, deposits: [deposit] }))).toBe(3);
    tx.outputs[tx.outputs.length - 1] = { lockingBytecode: otherLock, valueSatoshis: 5000n, token: { category: hexToBin(PUSD), amount: 1n } };
    expect(ruleOf(run(tx, built.sourceOutputs, { ...e, spend, deposits: [deposit] }))).toBe(3);
    expect(ruleOf(run(built.transaction, built.sourceOutputs, { ...e, deposits: [deposit] }))).toBe(3);
  });

  it('rule 4: fewer tokens than the minimum shown is refused', () => {
    const { built, e } = buy();
    expect(ruleOf(run(built.transaction, built.sourceOutputs, { ...e, receive: { category: PUSD, min: e.receive.min + 1n } }))).toBe(4);
  });

  it('rule 5: an unlisted user input, a foreign input, version 1 and a locktime are refused', () => {
    const { built, e } = buy();
    expect(ruleOf(run(built.transaction, built.sourceOutputs, { ...e, inputPaths: e.inputPaths.slice(1) }))).toBe(5);
    const foreign = built.sourceOutputs.map((o, i) => (i === built.userInputIndexes[0] ? { ...o, lockingBytecode: otherLock } : o));
    expect(ruleOf(run(built.transaction, foreign, e))).toBe(5);
    expect(ruleOf(run({ ...built.transaction, version: 1 }, built.sourceOutputs, e))).toBe(5);
    expect(ruleOf(run({ ...built.transaction, locktime: 1 }, built.sourceOutputs, e))).toBe(5);
  });

  it('rule 1/5: a pool that was not quoted is refused', () => {
    const { built, e } = buy();
    expect(run(built.transaction, built.sourceOutputs, { ...e, poolOwnerPkhs: e.poolOwnerPkhs.slice(1) }).ok).toBe(false);
  });

  it('property: random output tampering never yields an accepted transaction that pays a foreign address', () => {
    let seed = 0x5eed;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const { built, e } = buy();
    const allowed = new Set([binToHex(userLock), ...built.sourceOutputs.slice(0, e.poolOwnerPkhs.length).map((o) => binToHex(o.lockingBytecode))]);
    for (let k = 0; k < 300; k++) {
      const tx = structuredClone(built.transaction);
      const i = rand(tx.outputs.length);
      const out = tx.outputs[i]!;
      const what = rand(4);
      if (what === 0) out.lockingBytecode = otherLock;
      else if (what === 1) out.valueSatoshis += BigInt(rand(20_000)) - 10_000n;
      else if (what === 2 && out.token) out.token = { ...out.token, amount: out.token.amount + BigInt(rand(50)) - 25n };
      else tx.outputs.push({ lockingBytecode: otherLock, valueSatoshis: BigInt(546 + rand(5000)) });
      const r = run(tx, built.sourceOutputs, e);
      if (r.ok) {
        for (const o of tx.outputs) expect(allowed.has(binToHex(o.lockingBytecode))).toBe(true);
        const toUser = tx.outputs.filter((o) => binToHex(o.lockingBytecode) === binToHex(userLock));
        expect(toUser.reduce((s, o) => s + (o.token?.amount ?? 0n), 0n)).toBeGreaterThanOrEqual(e.receive.min);
      }
    }
  });
});
