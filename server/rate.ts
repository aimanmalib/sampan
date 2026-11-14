// Fixed-window counters in memory, per caller and per limit name. Enough for one process.
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number; windowMs: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  /** Counts one hit; returns false when the caller is over `max` in the current window. */
  hit(key: string, max: number, windowMs: number): boolean {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= windowMs) {
      this.windows.set(key, { start: t, count: 1, windowMs });
      if (this.windows.size > this.maxKeys) this.sweep();
      return true;
    }
    w.count += 1;
    return w.count <= max;
  }

  /** Drops windows that have ended. */
  sweep(): void {
    const t = this.now();
    for (const [k, w] of this.windows) if (t - w.start >= w.windowMs) this.windows.delete(k);
  }

  get size(): number {
    return this.windows.size;
  }
}
