// GET /api/depth and the peg guard. Pools come only from the PoolDirectory (pools whose lock rebuilds from the owner
// hash and holds that outpoint on chain); the BCH dollar price only from the active THORChain route's BCH.BCH pool.
// A reading is reused for cauldron.cacheSeconds. The indexer or the BCH servers down = the read fails (the API
// answers 503 with a message, never zeros); THORNode down = the price and the peg are unknown, nothing is refused.
import { midPriceE8, onePercentSats, pegBpsOf, pegLevelOf, type DepthReport, type PegConfig, type PegLevel } from '../core/peg.js';
import type { PoolUtxo } from '../core/pools/trade.js';

export interface DepthOptions {
  peg: PegConfig;
  /** Verified pools of the default token (PoolDirectory.active). */
  pools: () => Promise<PoolUtxo[]>;
  /** THORChain's USD per BCH, 8 decimals; null or a throw = unknown. */
  bchUsd: () => Promise<bigint | null>;
  symbol: string;
  decimals: number;
  cacheSeconds: number;
  sources: { pools: string; price: string | null };
  now?: () => number;
  log?: ((message: string) => void) | undefined;
}

export class DepthReader {
  private cached: { at: number; report: DepthReport } | null = null;
  private running: Promise<DepthReport> | null = null;
  private readonly now: () => number;

  constructor(private readonly o: DepthOptions) {
    this.now = o.now ?? Date.now;
  }

  /** The current reading; throws when the pools cannot be read. */
  read(): Promise<DepthReport> {
    const hit = this.cached;
    if (hit && this.now() - hit.at < this.o.cacheSeconds * 1000) return Promise.resolve(hit.report);
    this.running ??= this.fresh().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** The peg level for the guard: never throws; anything unreadable is 'unknown' (no refusal). */
  async level(): Promise<PegLevel> {
    try {
      return (await this.read()).peg;
    } catch {
      return 'unknown';
    }
  }

  private async fresh(): Promise<DepthReport> {
    const [pools, price] = await Promise.all([this.o.pools(), this.price()]);
    let sats = 0n;
    let tokens = 0n;
    for (const p of pools) {
      sats += p.sats;
      tokens += p.tokens;
    }
    if (pools.length === 0 || sats === 0n || tokens === 0n) throw new Error('indexer: no verified pool for the token');
    const mid = midPriceE8(sats, tokens, this.o.decimals);
    const pegBps = price === null ? null : pegBpsOf(mid, price);
    const report: DepthReport = {
      pools: pools.length,
      bch: sats.toString(),
      token: tokens.toString(),
      symbol: this.o.symbol,
      decimals: this.o.decimals,
      midPriceE8: mid.toString(),
      onePercentBch: onePercentSats(sats).toString(),
      bchUsdE8: price === null ? null : price.toString(),
      pegBps,
      peg: pegLevelOf(pegBps, this.o.peg),
      read: this.now(),
      sources: this.o.sources,
    };
    this.cached = { at: report.read, report };
    return report;
  }

  private async price(): Promise<bigint | null> {
    try {
      const p = await this.o.bchUsd();
      return p !== null && p > 0n ? p : null;
    } catch (e) {
      this.o.log?.(`depth: BCH price unknown: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}
