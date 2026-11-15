// The server's own finisher (flow L step 4 and 5). Holds no key. Every landing address still being watched is
// subscribed on Electrum; a change there, a poll every `landing.pollSeconds`, or a kick from the status page runs
// finishLanding for that address: convert as soon as the pools meet the contract minimum (0-conf is fine), or give
// the BCH back once the coin is `returnAfterBlocks` old. Watching resumes from the database after a restart, and an
// address that received nothing for `landing.idleDays` stops being watched (its recovery card still works).
import type { SampanConfig } from '../../core/config.js';
import { readCard } from '../../core/landing-card.js';
import { landingLockingHex, type LandingParams } from '../../core/landing.js';
import type { PoolUtxo } from '../../core/pools/trade.js';
import type { Chain } from '../chain/types.js';
import type { Db, LandingRow } from '../db.js';
import { finishLanding, type FinishResult } from './finish.js';

const DAY_MS = 86_400_000;
const ERROR_CHARS = 500;

export interface LandingWatcherOptions {
  config: SampanConfig;
  db: Db;
  chain: Chain;
  loadPools: (category: string) => Promise<PoolUtxo[]>;
  now?: () => number;
  log?: ((message: string) => void) | undefined;
}

export class LandingWatcher {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly again = new Set<string>();
  private readonly unwatch = new Map<string, () => void>();
  private timer: NodeJS.Timeout | undefined;
  private readonly now: () => number;

  constructor(private readonly o: LandingWatcherOptions) {
    this.now = o.now ?? Date.now;
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.o.config.landing.pollSeconds * 1000);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    for (const off of this.unwatch.values()) off();
    this.unwatch.clear();
  }

  /** Addresses currently subscribed. */
  get watching(): number {
    return this.unwatch.size;
  }

  /** One pass over every watched landing. Errors are recorded on the crossing and do not stop the pass. */
  async tick(): Promise<void> {
    for (const row of this.o.db.watchedLandings()) {
      this.subscribe(row);
      await this.finish(row.address);
    }
  }

  /** "Check again" on the status page: finish this landing now. False when it is not a watched landing. */
  async kick(crossingId: string): Promise<boolean> {
    const row = this.o.db.landingOf(crossingId);
    if (!row || row.status !== 'watching') return false;
    this.subscribe(row);
    await this.finish(row.address);
    return true;
  }

  private subscribe(row: LandingRow): void {
    if (this.unwatch.has(row.address)) return;
    const params = this.params(row);
    if (!params) return;
    this.unwatch.set(row.address, this.o.chain.watch(landingLockingHex(params), () => void this.finish(row.address)));
  }

  private params(row: LandingRow): LandingParams | undefined {
    const read = readCard(JSON.parse(row.params_json));
    if (typeof read === 'string') {
      this.o.log?.(`landing ${row.address}: stored card is unusable (${read})`);
      return undefined;
    }
    return read.params;
  }

  /** Runs one finish per address at a time; a request that arrives meanwhile runs once more afterwards. */
  finish(address: string): Promise<void> {
    const running = this.inFlight.get(address);
    if (running) {
      this.again.add(address);
      return running;
    }
    const run = (async () => {
      do {
        this.again.delete(address);
        await this.finishOnce(address);
      } while (this.again.has(address));
    })().finally(() => this.inFlight.delete(address));
    this.inFlight.set(address, run);
    return run;
  }

  private async finishOnce(address: string): Promise<void> {
    const row = this.o.db.landingByAddress(address);
    if (!row || row.status !== 'watching') return;
    const params = this.params(row);
    if (!params) return;
    const { config, db } = this.o;
    let results: FinishResult[];
    try {
      results = await finishLanding(params, {
        chain: this.o.chain,
        loadPools: this.o.loadPools,
        maxPools: config.cauldron.maxPoolsPerTx,
        satsPerByte: BigInt(config.fees.satsPerByte),
        tokenDustSats: BigInt(config.landing.tokenDustSats),
        attempts: config.landing.finishAttempts,
      });
    } catch (e) {
      const crossing = db.getCrossing(row.crossing_id);
      db.updateCrossing(row.crossing_id, {
        error: (e instanceof Error ? e.message : String(e)).slice(0, ERROR_CHARS),
        attempts: (crossing?.attempts ?? 0) + 1,
      });
      this.o.log?.(`landing ${address}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.record(row, results);
  }

  private record(row: LandingRow, results: FinishResult[]): void {
    const { db } = this.o;
    const t = this.now();
    const coins = results.filter((r) => r.action !== 'skipped');
    if (coins.length === 0) {
      const quiet = t - (row.last_activity ?? row.created_at);
      if (quiet > this.o.config.landing.idleDays * DAY_MS) {
        db.updateLanding(row.address, { status: 'idle' });
        this.unwatch.get(row.address)?.();
        this.unwatch.delete(row.address);
      }
      return;
    }
    if (!row.utxo) db.updateLanding(row.address, { utxo: coins[0]!.coin, seen_at: t });
    db.updateLanding(row.address, { last_activity: t });
    const crossing = db.getCrossing(row.crossing_id);
    const attempts = (crossing?.attempts ?? 0) + 1;
    // Several coins can arrive at one address; the crossing shows the latest outcome.
    const done = coins.filter((r) => r.action === 'converted' || r.action === 'returned');
    const last = done[done.length - 1];
    if (last && 'txid' in last) {
      const status = last.action === 'converted' ? 'converted' : 'returned';
      db.updateLanding(row.address, { finish_txid: last.txid, finished_at: t });
      db.updateCrossing(row.crossing_id, { status, txid: last.txid, error: null, attempts });
      return;
    }
    const waiting = coins.find((r) => r.action === 'waiting');
    if (crossing?.status === 'open' || waiting) {
      db.updateCrossing(row.crossing_id, {
        status: 'seen',
        attempts,
        error: waiting && 'reason' in waiting ? waiting.reason.slice(0, ERROR_CHARS) : null,
      });
    }
  }
}
