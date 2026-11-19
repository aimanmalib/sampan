// Pure helpers for the pool depth and slippage measurement (tools/measure/token-pools.ts). No I/O.
// Slip = (average price of the best pool - price received) / average price, both in units received per unit given.
import { candidatePools, selectTrade, type PoolUtxo, type SelectedTrade } from '../../core/pools/trade.js';

export interface PoolTotals {
  pools: number;
  sats: bigint;
  tokens: bigint;
}

export interface SlipResult {
  side: 'buy' | 'sell';
  supply: bigint;
  demand: bigint;
  pools: number;
  slipBps: number;
}

export const poolTotals = (pools: PoolUtxo[]): PoolTotals => ({
  pools: pools.length,
  sats: pools.reduce((s, p) => s + p.sats, 0n),
  tokens: pools.reduce((s, p) => s + p.tokens, 0n),
});

/** Slip of one trade against the spot price of the deepest pool, in basis points (rounded up). */
export const slipBps = (trade: SelectedTrade, best: PoolUtxo): number => {
  // buy: tokens per sat; sell: sats per token. avg = best.out / best.in; got = demand / supply.
  const [outReserve, inReserve] = trade.side === 'buy' ? [best.tokens, best.sats] : [best.sats, best.tokens];
  const num = (outReserve * trade.supply - trade.demand * inReserve) * 10_000n;
  const den = outReserve * trade.supply;
  return Number((num + den - 1n) / den);
};

export interface MeasureOptions {
  sats: bigint;
  maxPools: number;
  satsPerByte: bigint;
}

/** Buy `sats` worth of tokens, then sell the tokens received back, each priced against the deepest pool. */
export const measureSlip = (pools: PoolUtxo[], category: string, o: MeasureOptions): SlipResult[] => {
  const best = candidatePools(pools, category, 1)[0];
  if (!best) throw new Error('no pool for this token');
  const run = (side: 'buy' | 'sell', amount: bigint): SlipResult => {
    const t = selectTrade(pools, category, { side, target: 'supply', amount, maxPools: o.maxPools, satsPerByte: o.satsPerByte });
    return { side, supply: t.supply, demand: t.demand, pools: t.legs.length, slipBps: slipBps(t, best) };
  };
  const buy = run('buy', o.sats);
  return [buy, run('sell', buy.demand)];
};
