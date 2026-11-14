// Cauldron pool discovery. The indexer only says which pools exist; every pool is accepted once its owner hash
// rebuilds (pool v0 template) to a locking bytecode that really holds that outpoint on chain. Pool state used
// to build a transaction always comes fresh from Electrum (see server/pools.ts), never from this cache.
import { poolV0LockingHex } from '../core/pools/template.js';
import type { PoolUtxo } from '../core/pools/trade.js';
import type { Chain } from './chain/types.js';

export interface IndexerPool {
  owner_pkh: string;
  sats: number | string;
  tokens: number | string;
  tx_pos: number;
  txid: string;
  token_id?: string;
}

/** Fetches `GET <indexer>/cauldron/pool/active?token=<category>`; injected so tests never touch the network. */
export type FetchActive = (indexer: string, category: string) => Promise<IndexerPool[]>;

export const httpFetchActive =
  (timeoutMs = 8000): FetchActive =>
  async (indexer, category) => {
    const url = `${indexer.replace(/\/$/, '')}/cauldron/pool/active?token=${encodeURIComponent(category)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`indexer answered ${res.status}`);
    const body = (await res.json()) as { active?: IndexerPool[] };
    if (!Array.isArray(body.active)) throw new Error('indexer answer has no active list');
    return body.active;
  };

/** Pools checked against the chain at once on a cold cache. */
const VERIFY_BATCH = 10;
const HEX20 = /^[0-9a-f]{40}$/;
const HEX32 = /^[0-9a-f]{64}$/;

export interface PoolDirectoryOptions {
  indexers: string[];
  cacheSeconds: number;
  fetchActive: FetchActive;
  chain: Chain;
  now?: () => number;
}

export class PoolDirectory {
  private readonly cache = new Map<string, { at: number; pools: PoolUtxo[] }>();
  /** outpoint -> rebuilt lock matched the chain. Checked once per pool UTXO. */
  private readonly verified = new Map<string, boolean>();
  private readonly now: () => number;

  constructor(private readonly o: PoolDirectoryOptions) {
    this.now = o.now ?? Date.now;
  }

  /** Active pools for a token, at most `cacheSeconds` old, with unverifiable pools removed. */
  async active(category: string): Promise<PoolUtxo[]> {
    const hit = this.cache.get(category);
    if (hit && this.now() - hit.at < this.o.cacheSeconds * 1000) return hit.pools;
    const raw = await this.fetchAny(category);
    const shaped = raw.flatMap((p) => shape(p, category));
    const kept: PoolUtxo[] = [];
    for (let i = 0; i < shaped.length; i += VERIFY_BATCH) {
      const batch = shaped.slice(i, i + VERIFY_BATCH);
      const ok = await Promise.all(batch.map((p) => this.matchesChain(p)));
      batch.forEach((p, j) => ok[j] && kept.push(p));
    }
    this.cache.set(category, { at: this.now(), pools: kept });
    return kept;
  }

  private async fetchAny(category: string): Promise<IndexerPool[]> {
    let last: unknown;
    for (const indexer of this.o.indexers) {
      try {
        return await this.o.fetchActive(indexer, category);
      } catch (e) {
        last = e;
      }
    }
    throw new Error(`no Cauldron indexer answered: ${last instanceof Error ? last.message : String(last)}`);
  }

  private async matchesChain(pool: PoolUtxo): Promise<boolean> {
    const key = `${pool.txid}:${pool.vout}`;
    const known = this.verified.get(key);
    if (known !== undefined) return known;
    const utxos = await this.o.chain.listUnspent(poolV0LockingHex(pool.ownerPkh));
    // A pool spent since the indexer saw it still proves its template if its successor sits at the same lock.
    const ok = utxos.some((u) => u.token?.category === pool.category && !u.token.nft);
    this.verified.set(key, ok);
    return ok;
  }
}

const shape = (p: IndexerPool, category: string): PoolUtxo[] => {
  const ownerPkh = String(p.owner_pkh ?? '').toLowerCase();
  const txid = String(p.txid ?? '').toLowerCase();
  if (!HEX20.test(ownerPkh) || !HEX32.test(txid) || !Number.isInteger(p.tx_pos)) return [];
  if (p.token_id !== undefined && p.token_id.toLowerCase() !== category) return [];
  try {
    const sats = BigInt(p.sats);
    const tokens = BigInt(p.tokens);
    if (sats <= 0n || tokens <= 0n) return [];
    return [{ txid, vout: p.tx_pos, sats, tokens, category, ownerPkh }];
  } catch {
    return [];
  }
};
