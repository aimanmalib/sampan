import { describe, expect, it } from 'vitest';
import { poolV0LockingHex } from '../core/pools/template.js';
import { PUSD, fixture } from '../tests/helpers/pools.js';
import { FakeChain } from './chain/fake.js';
import { PoolDirectory, type IndexerPool } from './indexer.js';
import { refreshPools } from './pools.js';

const onChain = (pools: IndexerPool[]): FakeChain => {
  const chain = new FakeChain();
  for (const p of pools)
    chain.add(poolV0LockingHex(p.owner_pkh), { txid: p.txid, vout: p.tx_pos, sats: BigInt(p.sats), height: 1, token: { category: PUSD, amount: BigInt(p.tokens) } });
  return chain;
};

describe('PoolDirectory', () => {
  it('keeps only pools whose rebuilt lock holds a pool UTXO on chain', async () => {
    const [real, forged] = fixture.active as IndexerPool[];
    const chain = onChain([real!]);
    const dir = new PoolDirectory({ indexers: ['https://i.example'], cacheSeconds: 5, chain, fetchActive: async () => [real!, forged!] });
    const pools = await dir.active(PUSD);
    expect(pools.map((p) => p.ownerPkh)).toEqual([real!.owner_pkh]);
  });

  it('reuses one indexer answer for cacheSeconds, then asks again', async () => {
    let calls = 0;
    let now = 0;
    const chain = onChain(fixture.active as IndexerPool[]);
    const dir = new PoolDirectory({
      indexers: ['https://i.example'],
      cacheSeconds: 5,
      chain,
      now: () => now,
      fetchActive: async () => {
        calls += 1;
        return fixture.active as IndexerPool[];
      },
    });
    await dir.active(PUSD);
    now = 4_999;
    await dir.active(PUSD);
    expect(calls).toBe(1);
    now = 5_000;
    await dir.active(PUSD);
    expect(calls).toBe(2);
  });

  it('falls back to the next indexer and ignores malformed or foreign-token entries', async () => {
    const good = fixture.active[0] as IndexerPool;
    const chain = onChain([good]);
    const dir = new PoolDirectory({
      indexers: ['https://down.example', 'https://up.example'],
      cacheSeconds: 5,
      chain,
      fetchActive: async (indexer) => {
        if (indexer.includes('down')) throw new Error('indexer answered 502');
        return [good, { ...good, owner_pkh: 'zz' }, { ...good, token_id: 'ff'.repeat(32) }, { ...good, sats: 0 }];
      },
    });
    expect(await dir.active(PUSD)).toHaveLength(1);
  });

  it('reports when no indexer answers', async () => {
    const dir = new PoolDirectory({ indexers: ['https://x.example'], cacheSeconds: 5, chain: new FakeChain(), fetchActive: async () => Promise.reject(new Error('down')) });
    await expect(dir.active(PUSD)).rejects.toThrow(/indexer/);
  });
});

describe('refreshPools', () => {
  it('replaces a pool spent since discovery with the UTXO now at its lock, and drops empty locks', async () => {
    const [a, b] = fixture.active as IndexerPool[];
    const chain = new FakeChain();
    chain.add(poolV0LockingHex(a!.owner_pkh), { txid: 'cd'.repeat(32), vout: 3, sats: 123_456_789n, height: 0, token: { category: PUSD, amount: 4321n } });
    const discovered = (fixture.active as IndexerPool[]).slice(0, 2).map((p) => ({
      txid: p.txid,
      vout: p.tx_pos,
      sats: BigInt(p.sats),
      tokens: BigInt(p.tokens),
      category: PUSD,
      ownerPkh: p.owner_pkh,
    }));
    const fresh = await refreshPools(chain, discovered);
    expect(fresh).toEqual([{ txid: 'cd'.repeat(32), vout: 3, sats: 123_456_789n, tokens: 4321n, category: PUSD, ownerPkh: a!.owner_pkh }]);
    expect(fresh.some((p) => p.ownerPkh === b!.owner_pkh)).toBe(false);
  });
});
