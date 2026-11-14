// Trade selection across Cauldron pools. Pure: no I/O.
// Selection uses cashlab's ExchangeLab (best rate for a target supply or demand); every pool leg it
// returns is then re-checked with our own copy of the on-chain condition before it is used.
import { binToHex, hexToBin } from '@bitauth/libauth';
import { ExchangeLab, type PoolV0 } from '@cashlab/cauldron';
import { poolAccepts, poolAfter, type PoolState } from './math.js';
import { poolV0LockingBytecode } from './template.js';

/** One live pool UTXO (indexer discovery, refreshed from Electrum before use). */
export interface PoolUtxo {
  txid: string;
  vout: number;
  sats: bigint;
  tokens: bigint;
  category: string;
  ownerPkh: string;
}

export type TradeSide = 'buy' | 'sell'; // buy = BCH in, tokens out; sell = tokens in, BCH out
export type TradeTarget = 'supply' | 'demand';

export interface PoolLeg {
  pool: PoolUtxo;
  supply: bigint;
  demand: bigint;
  after: PoolState;
}

export interface SelectedTrade {
  side: TradeSide;
  category: string;
  legs: PoolLeg[];
  supply: bigint;
  demand: bigint;
}

export interface SelectOptions {
  side: TradeSide;
  target: TradeTarget;
  amount: bigint;
  maxPools: number;
  satsPerByte: bigint;
}

const toCashlab = (p: PoolUtxo): PoolV0 => {
  const pkh = hexToBin(p.ownerPkh);
  return {
    version: '0',
    parameters: { withdraw_pubkey_hash: pkh },
    outpoint: { txhash: hexToBin(p.txid), index: p.vout },
    output: { locking_bytecode: poolV0LockingBytecode(pkh), amount: p.sats, token: { amount: p.tokens, token_id: p.category } },
  };
};

/** The deepest pools first; a transaction never spends more than `maxPools` of them. */
export const candidatePools = (pools: PoolUtxo[], category: string, maxPools: number): PoolUtxo[] =>
  pools
    .filter((p) => p.category === category && p.sats > 0n && p.tokens > 0n)
    .sort((a, b) => (b.sats === a.sats ? 0 : b.sats > a.sats ? 1 : -1))
    .slice(0, Math.max(1, maxPools));

export const selectTrade = (pools: PoolUtxo[], category: string, opts: SelectOptions): SelectedTrade => {
  if (opts.amount <= 0n) throw new RangeError('amount must be positive');
  const chosen = candidatePools(pools, category, opts.maxPools);
  if (chosen.length === 0) throw new Error('no pool for this token');
  const byOutpoint = new Map(chosen.map((p) => [`${p.txid}:${p.vout}`, p]));
  const [supplyId, demandId] = opts.side === 'buy' ? ['BCH', category] : [category, 'BCH'];
  const lab = new ExchangeLab();
  const input = chosen.map(toCashlab);
  const result =
    opts.target === 'supply'
      ? lab.constructTradeBestRateForTargetSupply(supplyId, demandId, opts.amount, input, opts.satsPerByte)
      : lab.constructTradeBestRateForTargetDemand(supplyId, demandId, opts.amount, input, opts.satsPerByte);
  const legs = result.entries.map((e): PoolLeg => {
    const pool = byOutpoint.get(`${binToHex(e.pool.outpoint.txhash)}:${e.pool.outpoint.index}`);
    if (!pool) throw new Error('trade used an unknown pool');
    const after = poolAfter(pool, opts.side, e.supply, e.demand);
    if (!poolAccepts(pool, after)) throw new Error('trade leg fails the pool condition');
    return { pool, supply: e.supply, demand: e.demand, after };
  });
  return {
    side: opts.side,
    category,
    legs,
    supply: legs.reduce((s, l) => s + l.supply, 0n),
    demand: legs.reduce((s, l) => s + l.demand, 0n),
  };
};
