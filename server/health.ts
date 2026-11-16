// Health of what the page depends on, checked every ops.healthIntervalSeconds: the Cauldron indexer (at least one
// pool for the default token), the Bitcoin Cash servers (a tip height) and, only while crossings are open, the active
// route (BCH and its destination chains not halted). The result feeds GET /api/health and the status line on the
// page; a route that reports a halt pauses new crossings on the server and shows "Paused by the route" on the page.
// Alerts are sent from the host (deploy/uptime.sh), not from this process.
import type { RouteId } from '../core/config.js';

export interface HealthReport {
  /** Unix milliseconds of the last finished check, or null before the first one. */
  checkedAt: number | null;
  cauldron: boolean | null;
  bch: boolean | null;
  height: number | null;
  /** Null while crossings are closed: the page does not mention a route then. */
  route: { id: RouteId; open: boolean | null } | null;
}

export interface HealthProbes {
  /** Number of usable pools for the default token. */
  pools: () => Promise<number>;
  tipHeight: () => Promise<number>;
  /** The active route's own view of BCH and the destination chains; absent while crossings are closed. */
  route?: { id: RouteId; open: () => Promise<boolean> };
  intervalMs: number;
  now?: () => number;
}

const settle = async <T>(p: () => Promise<T>): Promise<T | null> => {
  try {
    return await p();
  } catch {
    return null;
  }
};

export class HealthMonitor {
  private report: HealthReport;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<HealthReport> | null = null;

  constructor(private readonly o: HealthProbes) {
    this.report = { checkedAt: null, cauldron: null, bch: null, height: null, route: o.route ? { id: o.route.id, open: null } : null };
  }

  current(): HealthReport {
    return this.report;
  }

  /** False only when the last check saw the route halted; unknown counts as open (the route's own quote decides). */
  routeOpen(): boolean {
    return this.report.route?.open !== false;
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
    const [pools, height, open] = await Promise.all([
      settle(this.o.pools),
      settle(this.o.tipHeight),
      route ? settle(route.open) : Promise.resolve(null),
    ]);
    this.report = {
      checkedAt: (this.o.now ?? Date.now)(),
      cauldron: pools !== null && pools > 0,
      bch: height !== null && height > 0,
      height: height !== null && height > 0 ? height : null,
      route: route ? { id: route.id, open: open === true } : null,
    };
    return this.report;
  }

  start(): void {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.o.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
