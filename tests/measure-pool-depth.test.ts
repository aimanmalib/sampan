import { describe, expect, it } from 'vitest';
import type { PoolUtxo } from '../core/pools/trade.js';
import { measureSlip, poolTotals, slipBps } from '../tools/measure/pool-depth.js';

const CAT = 'ab'.repeat(32);
const pool = (n: number, sats: bigint, tokens: bigint): PoolUtxo => ({
  txid: n.toString(16).padStart(64, '0'),
  vout: 0,
  sats,
  tokens,
  category: CAT,
  ownerPkh: n.toString(16).padStart(40, '0'),
});

describe('pool depth measurement', () => {
  it('sums the pools it is given', () => {
    expect(poolTotals([pool(1, 100n, 7n), pool(2, 50n, 3n)])).toEqual({ pools: 2, sats: 150n, tokens: 10n });
  });

  it('prices a trade against the best pool in units received per unit given', () => {
    const best = pool(1, 1_000_000n, 10_000n); // 0.01 token unit per sat
    // Spot price exactly: 0 bps. Two percent worse: 200 bps. Sell side uses sats per token.
    expect(slipBps({ side: 'buy', category: CAT, legs: [], supply: 100_000n, demand: 1_000n }, best)).toBe(0);
    expect(slipBps({ side: 'buy', category: CAT, legs: [], supply: 100_000n, demand: 980n }, best)).toBe(200);
    expect(slipBps({ side: 'sell', category: CAT, legs: [], supply: 1_000n, demand: 98_000n }, best)).toBe(200);
  });

  it('a deep pool slips little and a shallow one a lot, both ways', () => {
    const opts = { sats: 100_000n, maxPools: 5, satsPerByte: 1n };
    const deep = measureSlip([pool(1, 10_000_000_000n, 2_000_000n)], CAT, opts);
    expect(deep.map((r) => r.side)).toEqual(['buy', 'sell']);
    for (const r of deep) expect(r.slipBps).toBeLessThan(200);
    const shallow = measureSlip([pool(2, 1_000_000n, 200n)], CAT, opts);
    expect(shallow[0]!.slipBps).toBeGreaterThanOrEqual(200);
  });

  it('refuses a token with no pool', () => {
    expect(() => measureSlip([], CAT, { sats: 100_000n, maxPools: 5, satsPerByte: 1n })).toThrow('no pool');
  });
});
