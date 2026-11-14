// Fresh pool state from Electrum, used right before a swap is built. A pool spent since discovery is replaced by
// the UTXO now sitting at its lock (the pool's successor); a lock with no pool UTXO left is dropped.
import { poolV0LockingHex } from '../core/pools/template.js';
import type { PoolUtxo } from '../core/pools/trade.js';
import type { Chain } from './chain/types.js';

export async function refreshPools(chain: Chain, pools: PoolUtxo[]): Promise<PoolUtxo[]> {
  const byOwner = new Map<string, PoolUtxo>();
  for (const p of pools) if (!byOwner.has(p.ownerPkh)) byOwner.set(p.ownerPkh, p);
  const fresh = await Promise.all(
    [...byOwner.values()].map(async (p) => {
      const live = (await chain.listUnspent(poolV0LockingHex(p.ownerPkh)))
        .filter((u) => u.token && u.token.category === p.category && !u.token.nft && u.token.amount > 0n && u.sats > 0n)
        .sort((a, b) => (b.sats > a.sats ? 1 : b.sats < a.sats ? -1 : 0))[0];
      return live
        ? [{ txid: live.txid, vout: live.vout, sats: live.sats, tokens: live.token!.amount, category: p.category, ownerPkh: p.ownerPkh }]
        : [];
    }),
  );
  return fresh.flat();
}
