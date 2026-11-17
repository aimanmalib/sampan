// Health of what the page depends on, checked every ops.healthIntervalSeconds: the Cauldron indexer (at least one
// pool for the default token), the Bitcoin Cash servers (a tip height) and, only while crossings are open, the active
// route (one map of open chains; the route counts as open while BCH and at least one live asset's chain are open). The result feeds GET /api/health and the status line on the
// page; a route that reports a halt pauses new crossings on the server and shows "Paused by the route" on the page.
// Alerts are sent from the host (deploy/uptime.sh), not from this process.
import type { RouteId } from '../core/config.js';
import { routeOpenFor, type OpenMap, type RouteAsset } from '../core/route-assets.js';
import { ChainUnavailableError } from './chain/types.js';

export interface HealthReport {
  /** Unix milliseconds of the last finished check, or null before the first one. */
  checkedAt: number | null;
  /** Null before the first check, and while the Bitcoin Cash servers are down (pools cannot be checked then). */
  cauldron: boolean | null;
  bch: boolean | null;
  height: number | null;
  /** Null while crossings are closed: the page does not mention a route then. */
  /** `chains`: the route's open map from the last check (null while unknown); a closed chain hides its assets alone. */
  route: { id: RouteId; open: boolean | null; chains: OpenMap | null } | null;
}

export interface HealthProbes {
  /** Number of usable pools for the default token. */
  pools: () => Promise<number>;
  tipHeight: () => Promise<number>;
  /** The active route's open map and the assets it may offer; absent while crossings are closed. */
  route?: { id: RouteId; open: () => Promise<OpenMap>; assets: RouteAsset[] };
  intervalMs: number;
  /** Next check comes this soon while any probe is down. */
  retryMs: number;
  now?: () => number;
  log?: ((message: string) => void) | undefined;
}

const settle = async <T>(name: string, p: () => Promise<T>, log?: (m: string) => void): Promise<T | null> => {
  try {
    return await p();
  } catch (e) {
    log?.(`health: ${name} probe failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
};

export class HealthMonitor {
  private report: HealthReport;
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private running: Promise<HealthReport> | null = null;

  constructor(private readonly o: HealthProbes) {
    this.report = { checkedAt: null, cauldron: null, bch: null, height: null, route: o.route ? { id: o.route.id, open: null, chains: null } : null };
  }

  current(): HealthReport {
    return this.report;
  }

  /** False only when the last check saw the route halted; unknown counts as open (the route's own quote decides). */
  routeOpen(): boolean {
    return this.report.route?.open !== false;
  }

  /** False only when the last check saw this chain closed; unknown counts as open (the route's own quote decides). */
  chainOpen(chain: string): boolean {
    const chains = this.report.route?.chains;
    return !chains || chains[chain] === true;
  }

  /** Runs one check (joins a check already in flight). */
  check(): Promise<HealthReport> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<HealthReport> {
    const { route } = this.o;
    // Pools are checked against the Bitcoin Cash servers; with those down the indexer's own state is unknown.
    let poolsUnknown = false;
    const pools0 = async (): Promise<number> => {
      try {
        return await this.o.pools();
      } catch (e) {
        poolsUnknown = e instanceof ChainUnavailableError;
        throw e;
      }
    };
    const [pools, height, chains] = await Promise.all([
      settle('cauldron', pools0, this.o.log),
      settle('bch', this.o.tipHeight, this.o.log),
      route ? settle('route', route.open, this.o.log) : Promise.resolve(null),
    ]);
    this.report = {
      checkedAt: (this.o.now ?? Date.now)(),
      cauldron: poolsUnknown ? null : pools !== null && pools > 0,
      bch: height !== null && height > 0,
      height: height !== null && height > 0 ? height : null,
      // A route that cannot be asked stays unknown (null): shown as not answering, never as paused.
      route: route ? { id: route.id, open: chains === null ? null : routeOpenFor(chains, route.assets), chains } : null,
    };
    return this.report;
  }

  /** True when every probe the monitor runs answered well. */
  allOk(): boolean {
    const r = this.report;
    return r.cauldron === true && r.bch === true && (r.route === null || r.route.open === true);
  }

  /** Checks now, then every intervalMs, or every retryMs while something is down. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const tick = (): void => {
      void this.check().then(() => {
        if (!this.started) return;
        this.timer = setTimeout(tick, this.allOk() ? this.o.intervalMs : this.o.retryMs);
        this.timer.unref();
      });
    };
    tick();
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
