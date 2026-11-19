// "You keep" per network (core/keep.ts, ADR 0074): a paused network never wins, a failed quote is a row without
// numbers, the best mark needs two priced open rows that differ, the list keeps the picked network within the limit,
// and the shipped config carries valid keepCompare limits behind a flag.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CostCard } from '../core/cost.js';
import { keepList, keepRows, routeKeepPct, validateKeep, type KeepInput } from '../core/keep.js';

const card = (keepPct: number): CostCard => ({
  payUsd: 2_000_000n,
  receiveUsd: BigInt(Math.round(keepPct * 20_000)),
  totalUsd: 0n,
  leftoverUsd: 0n,
  keepPct,
  parts: [],
  impactBps: 0,
  minutes: { from: 2 },
  expiresAt: 0,
  warn: { impact: false, cost: false },
});
const ok = (asset: string, pct: number, open = true): KeepInput => ({ asset, open, quote: { status: 'ok', card: card(pct), receive: '1.90' } });

describe('keepRows', () => {
  it('marks the open row that keeps the most', () => {
    const rows = keepRows([ok('ETH.USDC', 90.5), ok('BSC.USDC', 96.2), ok('AVAX.USDC', 95)]);
    expect(rows.map((r) => r.best)).toEqual([false, true, false]);
  });

  it('never marks a paused row, even when its last quote kept more', () => {
    const rows = keepRows([ok('ETH.USDC', 99.9, false), ok('BSC.USDC', 96.2), ok('AVAX.USDC', 95)]);
    expect(rows.find((r) => r.best)?.asset).toBe('BSC.USDC');
    expect(rows[0]!.best).toBe(false);
  });

  it('keeps a failed quote as a row without numbers and still compares the others', () => {
    const rows = keepRows([{ asset: 'ETH.USDC', open: true, quote: { status: 'error', code: 'below_min' } }, ok('BSC.USDC', 96.2), ok('AVAX.USDC', 95)]);
    expect(rows[0]).toMatchObject({ asset: 'ETH.USDC', best: false, quote: { status: 'error' } });
    expect(rows[1]!.best).toBe(true);
  });

  it('marks nothing with one priced row, or when every priced row keeps the same', () => {
    expect(keepRows([ok('BSC.USDC', 96.2), { asset: 'ETH.USDC', open: true, quote: { status: 'pending' } }]).some((r) => r.best)).toBe(false);
    expect(keepRows([ok('BSC.USDC', 96.2), ok('ETH.USDC', 96.2)]).some((r) => r.best)).toBe(false);
  });
});

describe('keepList', () => {
  const rows = [
    { asset: 'A', open: true },
    { asset: 'B', open: false },
    { asset: 'C', open: true },
    { asset: 'D', open: true },
  ];
  it('lists paused rows outside the limit and open rows up to it, in order', () => {
    expect(keepList(rows, 2, 'A').map((r) => r.asset)).toEqual(['A', 'B', 'C']);
  });
  it('keeps the picked network when it falls past the limit', () => {
    expect(keepList(rows, 2, 'D').map((r) => r.asset)).toEqual(['A', 'B', 'D']);
  });
});

describe('routeKeepPct', () => {
  const usd = ['PUSD', 'USDC', 'USDT'];
  it('is the share kept when both sides count as USD 1, cut to two decimals', () => {
    expect(routeKeepPct({ amount: '2', symbol: 'PUSD' }, { amount: '1.9137', symbol: 'USDC' }, usd)).toBe(95.68);
  });
  it('is null when one side is BCH', () => {
    expect(routeKeepPct({ amount: '0.01', symbol: 'BCH' }, { amount: '3.1', symbol: 'USDC' }, usd)).toBeNull();
    expect(routeKeepPct({ amount: '2', symbol: 'USDC' }, { amount: '0.004', symbol: 'BCH' }, usd)).toBeNull();
  });
});

describe('keepCompare config', () => {
  const shipped = JSON.parse(readFileSync('config/sampan.json', 'utf8')) as { features: Record<string, unknown>; keepCompare: { maxNetworks: number; debounceMs: number } };
  it('ships valid limits and a boolean flag', () => {
    expect(validateKeep(shipped.keepCompare)).toEqual([]);
    expect(typeof shipped.features['keepCompare']).toBe('boolean');
  });
  it.each([
    [{ maxNetworks: 1, debounceMs: 700 }, 'keepCompare.maxNetworks'],
    [{ maxNetworks: 4.5, debounceMs: 700 }, 'keepCompare.maxNetworks'],
    [{ maxNetworks: 4, debounceMs: 50 }, 'keepCompare.debounceMs'],
    [{ maxNetworks: 4, debounceMs: 9000 }, 'keepCompare.debounceMs'],
  ])('refuses %o', (k, field) => {
    expect(validateKeep(k).join(' ')).toContain(field);
  });
  it('refuses a missing block', () => {
    expect(validateKeep(undefined)).toHaveLength(2);
  });
});
