import { binToHex, cashAddressToLockingBytecode, encodeLockingBytecodeP2pkh, hexToBin } from '@bitauth/libauth';
import { ExchangeLab, type PoolV0 } from '@cashlab/cauldron';
import { describe, expect, it } from 'vitest';
import { PUSD, fixture, pools } from '../../tests/helpers/pools.js';
import {
  poolAccepts,
  poolAfter,
  satsInForTokens,
  satsOutForTokens,
  tokensInForSats,
  tokensOutForSats,
} from './math.js';
import { poolV0LockingBytecode } from './template.js';
import { selectTrade, type PoolUtxo } from './trade.js';

const lab = new ExchangeLab();
const asCashlab = (p: PoolUtxo): PoolV0 => ({
  version: '0',
  parameters: { withdraw_pubkey_hash: hexToBin(p.ownerPkh) },
  outpoint: { txhash: hexToBin(p.txid), index: p.vout },
  output: {
    locking_bytecode: lab.generatePoolV0LockingBytecode({ withdraw_pubkey_hash: hexToBin(p.ownerPkh) }),
    amount: p.sats,
    token: { amount: p.tokens, token_id: p.category },
  },
});

describe('pool v0 locking bytecode', () => {
  it('matches the cashlab template for every captured pool', () => {
    expect(pools.length).toBeGreaterThan(5);
    for (const p of pools) {
      const pkh = hexToBin(p.ownerPkh);
      expect(binToHex(poolV0LockingBytecode(pkh))).toBe(binToHex(lab.generatePoolV0LockingBytecode({ withdraw_pubkey_hash: pkh })));
    }
  });
  it('uses the owner hash the indexer reports with the owner address', () => {
    for (const p of fixture.active) {
      const decoded = cashAddressToLockingBytecode(p.owner_p2pkh_addr);
      if (typeof decoded === 'string') throw new Error(decoded);
      expect(binToHex(decoded.bytecode)).toBe(binToHex(encodeLockingBytecodeP2pkh(hexToBin(p.owner_pkh))));
    }
  });
  it('rejects an owner hash of the wrong length', () => {
    expect(() => poolV0LockingBytecode(new Uint8Array(19))).toThrow();
  });
});

describe('pool arithmetic against cashlab on captured pools', () => {
  const amounts = [100_000n, 1_000_000n, 25_000_000n];
  it('buy legs: our condition accepts each cashlab leg and our quote is at least as good', () => {
    for (const p of pools) {
      for (const amount of amounts) {
        const r = lab.constructTradeBestRateForTargetSupply('BCH', PUSD, amount, [asCashlab(p)], 1n);
        for (const e of r.entries) {
          expect(poolAccepts(p, poolAfter(p, 'buy', e.supply, e.demand))).toBe(true);
          const ours = tokensOutForSats(p, e.supply);
          expect(ours).toBeGreaterThanOrEqual(e.demand);
          expect(poolAccepts(p, poolAfter(p, 'buy', e.supply, ours))).toBe(true);
          expect(poolAccepts(p, poolAfter(p, 'buy', e.supply, ours + 1n))).toBe(false);
        }
      }
    }
  });
  it('sell legs: our condition accepts each cashlab leg and our quote is at least as good', () => {
    for (const p of pools) {
      for (const amount of [50n, 1_000n, 20_000n]) {
        if (amount * 4n > p.tokens) continue;
        const r = lab.constructTradeBestRateForTargetSupply(PUSD, 'BCH', amount, [asCashlab(p)], 1n);
        for (const e of r.entries) {
          expect(poolAccepts(p, poolAfter(p, 'sell', e.supply, e.demand))).toBe(true);
          const ours = satsOutForTokens(p, e.supply);
          expect(ours).toBeGreaterThanOrEqual(e.demand);
          expect(poolAccepts(p, poolAfter(p, 'sell', e.supply, ours))).toBe(true);
          expect(poolAccepts(p, poolAfter(p, 'sell', e.supply, ours + 1n))).toBe(false);
        }
      }
    }
  });
  it('target-demand helpers are the exact inverse at the boundary', () => {
    const p = pools[0] as PoolUtxo;
    const x = satsInForTokens(p, 500n);
    expect(poolAccepts(p, poolAfter(p, 'buy', x, 500n))).toBe(true);
    expect(poolAccepts(p, poolAfter(p, 'buy', x - 1n, 500n))).toBe(false);
    const y = tokensInForSats(p, 1_000_000n);
    expect(poolAccepts(p, poolAfter(p, 'sell', y, 1_000_000n))).toBe(true);
    expect(poolAccepts(p, poolAfter(p, 'sell', y - 1n, 1_000_000n))).toBe(false);
  });
});

describe('selectTrade', () => {
  it('spends at most maxPools pools and every leg passes the pool condition', () => {
    for (const maxPools of [1, 3, 5]) {
      const t = selectTrade(pools, PUSD, { side: 'buy', target: 'supply', amount: 5_000_000n, maxPools, satsPerByte: 1n });
      expect(t.legs.length).toBeGreaterThan(0);
      expect(t.legs.length).toBeLessThanOrEqual(maxPools);
      expect(t.supply).toBeLessThanOrEqual(5_000_000n);
      for (const l of t.legs) expect(poolAccepts(l.pool, l.after)).toBe(true);
    }
  });
  it('meets a target demand when selling tokens', () => {
    const t = selectTrade(pools, PUSD, { side: 'sell', target: 'demand', amount: 200_000n, maxPools: 3, satsPerByte: 1n });
    expect(t.demand).toBeGreaterThanOrEqual(200_000n);
  });
  it('refuses a token with no pool', () => {
    expect(() => selectTrade(pools, 'ff'.repeat(32), { side: 'buy', target: 'supply', amount: 1000n, maxPools: 3, satsPerByte: 1n })).toThrow();
  });
});
