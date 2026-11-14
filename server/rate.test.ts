import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate.js';

describe('RateLimiter', () => {
  it('allows max hits per window per key, then resets', () => {
    let now = 0;
    const r = new RateLimiter(() => now);
    expect([1, 2, 3].map(() => r.hit('a', 2, 1000))).toEqual([true, true, false]);
    expect(r.hit('b', 2, 1000)).toBe(true);
    now = 1000;
    expect(r.hit('a', 2, 1000)).toBe(true);
  });

  it('sweeps ended windows by their own length', () => {
    let now = 0;
    const r = new RateLimiter(() => now, 1);
    r.hit('minute', 1, 60_000);
    r.hit('hour', 1, 3_600_000);
    now = 61_000;
    r.sweep();
    expect(r.size).toBe(1);
  });
});
