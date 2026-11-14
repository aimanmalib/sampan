// Wallet scan. The page derives addresses from the wallet's xpubs and sends them in batches per path; the server
// returns history and UTXOs (with token data) and says whether the gap limit has been reached. Results live in
// memory for `wallet.scanCacheSeconds` and are never written to disk.
import { parseAddress, type CashPrefix } from '../core/address.js';
import type { Chain, ChainUtxo } from './chain/types.js';

export const WALLET_PATHS = ['receive', 'change', 'defi'] as const;
export type WalletPath = (typeof WALLET_PATHS)[number];

export interface ScanRequest {
  paths: Partial<Record<WalletPath, string[]>>;
  /** Derivation index of the first address in every list (0 for the first batch). */
  start?: number;
}

export interface ScannedAddress {
  address: string;
  used: boolean;
  utxos: ChainUtxo[];
}

export interface ScanResult {
  paths: Partial<Record<WalletPath, { addresses: ScannedAddress[]; more: boolean }>>;
}

export class ScanInputError extends Error {}

export interface ScannerOptions {
  chain: Chain;
  prefix: CashPrefix;
  gapLimit: number;
  maxAddresses: number;
  cacheSeconds: number;
  now?: () => number;
  /** Runs before a first batch (start 0) with the lock of receive/0; the fake network funds new wallets here. */
  beforeFirstScan?: ((receiveZeroLock: string) => void) | undefined;
}

export class Scanner {
  private readonly cache = new Map<string, { at: number; used: boolean; utxos: ChainUtxo[] }>();
  private readonly now: () => number;

  constructor(private readonly o: ScannerOptions) {
    this.now = o.now ?? Date.now;
  }

  async scan(req: ScanRequest): Promise<ScanResult> {
    const batches = WALLET_PATHS.flatMap((p) => (req.paths[p] ? [[p, req.paths[p]] as const] : []));
    const total = batches.reduce((n, [, list]) => n + list.length, 0);
    if (total === 0) throw new ScanInputError('no addresses to scan');
    if (total > this.o.maxAddresses) throw new ScanInputError(`at most ${this.o.maxAddresses} addresses per scan`);
    const parsed = batches.map(([path, list]) => {
      const locks = list.map((a) => {
        const p = parseAddress(a, this.o.prefix);
        if (typeof p === 'string') throw new ScanInputError(`${a}: ${p}`);
        return p.lockingHex;
      });
      return { path, list, locks };
    });
    const receiveZero = parsed.find((b) => b.path === 'receive')?.locks[0];
    if ((req.start ?? 0) === 0 && receiveZero) this.o.beforeFirstScan?.(receiveZero);

    const result: ScanResult = { paths: {} };
    for (const { path, list, locks } of parsed) {
      const addresses = await Promise.all(list.map(async (address, i) => ({ address, ...(await this.one(locks[i]!)) })));
      let lastUsed = -1;
      addresses.forEach((a, i) => {
        if (a.used) lastUsed = i;
      });
      result.paths[path] = { addresses, more: addresses.length - 1 - lastUsed < this.o.gapLimit };
    }
    return result;
  }

  /** Drops cached results for these locks (after a broadcast that touched them). */
  forget(locks: string[]): void {
    for (const l of locks) this.cache.delete(l.toLowerCase());
  }

  private async one(lock: string): Promise<{ used: boolean; utxos: ChainUtxo[] }> {
    const hit = this.cache.get(lock);
    if (hit && this.now() - hit.at < this.o.cacheSeconds * 1000) return { used: hit.used, utxos: hit.utxos };
    const [count, utxos] = await Promise.all([this.o.chain.historyCount(lock), this.o.chain.listUnspent(lock)]);
    const entry = { at: this.now(), used: count > 0 || utxos.length > 0, utxos };
    this.cache.set(lock, entry);
    return { used: entry.used, utxos };
  }
}
