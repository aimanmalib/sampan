// The route comparison against answers recorded once from the live atomic swap API (tests/fixtures/atom, GET on
// 2026-11-17) and the frozen THORNode captures. No network.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WireInQuote } from '../core/client/in.js';
import type { WireOutQuote } from '../core/client/out.js';
import { buildProof } from '../core/proof.js';
import { atomFlowFor, compareRoutes, thorFromIn, thorFromOut, type AtomQuote, type CompareInput, type CompareFlow } from '../core/routes/compare.js';

const json = <T>(dir: string, name: string): T => JSON.parse(readFileSync(path.resolve('tests/fixtures', dir, name), 'utf8')) as T;
const atom = (name: string): AtomQuote => json<AtomQuote>('atom', name);
const thornode = (name: string) => json<{ expected_amount_out: string; total_swap_seconds: number; fees: { total: string; total_bps: number; asset: string } }>('thorchain', name);

const ASSET = 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913';
// THORNode answers in 1e8 units; the wire quote carries them as they are.
const outQuote = (): WireOutQuote => {
  const q = thornode('quote-out.json');
  return {
    source: 'PUSD', amount: '100', usd: 1, route: 'thorchain', sats: '1000000', vault: 'bitcoincash:q', memo: '', asset: ASSET,
    destination: '0x1a877169bB03400fA69EC4813889E78994D194Cb', expectedOut: q.expected_amount_out, minOut: '0', outDecimals: 8,
    fees: { total: q.fees.total, totalBps: q.fees.total_bps }, expiry: 0, seconds: q.total_swap_seconds,
  };
};
const inQuote = (): WireInQuote => {
  const q = thornode('quote-in.json');
  return { route: 'thorchain', asset: ASSET, amount: '200000000', destination: 'q', expectedSats: q.expected_amount_out, minSats: '0', expiry: 0, seconds: q.total_swap_seconds, usd: 2 };
};

const MEASURED = [
  '| UTC | flow | amount | txid | seconds | result |',
  '|---|---|---|---|---|---|',
  `| 2026-11-17T13:00:00Z | out | 2 USD | bch ${'12'.repeat(32)} · base 0x${'cd'.repeat(32)} | 700 | ok |`,
  `| 2026-11-17T14:00:00Z | out | 2 USD | bch ${'34'.repeat(32)} · base 0x${'ef'.repeat(32)} | 900 | ok |`,
  '| 2026-11-17T15:00:00Z | out | 2 USD | - | - | fail |',
].join('\n');

const OUT: CompareFlow = { kind: 'out', amount: '1', source: 'PUSD', chain: 'base', symbol: 'USDC' };
const IN: CompareFlow = { kind: 'in', amount: '2', chain: 'base', symbol: 'USDC', receive: 'PUSD' };
const config = { token: 'PUSD', atomFlows: ['usdc-to-pusd', 'pusd-to-usdc'] };
const input = (o: Partial<CompareInput>): CompareInput => ({
  flow: OUT, thor: thorFromOut(outQuote()), atom: atom('quote-pusd-to-usdc.json'), proof: buildProof(MEASURED), config, ...o,
});

describe('route comparison', () => {
  it('maps only PUSD out to USDC on Base and USDC on Base in to PUSD to an atom flow', () => {
    expect(atomFlowFor(OUT, 'PUSD')).toBe('pusd-to-usdc');
    expect(atomFlowFor(IN, 'PUSD')).toBe('usdc-to-pusd');
    expect(atomFlowFor({ ...OUT, source: 'BCH' }, 'PUSD')).toBeNull();
    expect(atomFlowFor({ ...IN, receive: 'BCH' }, 'PUSD')).toBeNull();
    expect(atomFlowFor({ ...OUT, chain: 'eth' }, 'PUSD')).toBeNull();
    expect(atomFlowFor({ ...OUT, symbol: 'USDT' }, 'PUSD')).toBeNull();
  });

  it('matches the chain key as config writes it (BASE), not only in lower case', () => {
    expect(atomFlowFor({ ...OUT, chain: 'BASE' }, 'PUSD')).toBe('pusd-to-usdc');
    expect(atomFlowFor({ ...IN, chain: 'BASE' }, 'PUSD')).toBe('usdc-to-pusd');
  });

  it('shows both routes for the same amount, with fees as each reports them and measured times', () => {
    const c = compareRoutes(input({}));
    const [thor, at] = c.rows;
    expect(c.rows).toHaveLength(2);
    expect(thor).toMatchObject({ route: 'thorchain', available: true, receive: '1.845256', receiveSymbol: 'USDC', fees: { total: '0.254405', totalBps: 1082 } });
    expect(thor!.seconds).toEqual({ median: 800, count: 2, estimate: 606 });
    const q = atom('quote-pusd-to-usdc.json');
    expect(at).toMatchObject({ route: 'atom', available: true, receive: q.amountOut, receiveSymbol: 'USDC' });
    expect(at!.fees).toEqual([q.networkFees.lock, q.networkFees.claim]);
    // The time is the measured median of the atom API, never one of the lock timeouts.
    expect(at!.seconds).toEqual({ median: q.measured.medianSeconds, count: q.measured.count });
    expect(at!.trust).toEqual({ kind: 'locks', userLockReturnsAfter: q.trust.userLockReturnsAfter, confirmations: q.trust.confirmations, anyoneMaySettle: true });
    expect(thor!.trust).toEqual({ kind: 'vaults', refundsToSender: true });
  });

  it('labels the row that receives more and still keeps THORChain selected', () => {
    const c = compareRoutes(input({}));
    expect(c.rows.map((r) => r.receivesMore)).toEqual([true, false]);
    expect(c.selected).toBe('thorchain');
    const atomMore = compareRoutes(input({ thor: { ...thorFromOut(outQuote()), receive: '0.5' } }));
    expect(atomMore.rows.map((r) => r.receivesMore)).toEqual([false, true]);
    expect(atomMore.selected).toBe('thorchain');
  });

  it('puts no label when the amounts are equal or the assets differ', () => {
    const q = atom('quote-pusd-to-usdc.json');
    const same = compareRoutes(input({ thor: { ...thorFromOut(outQuote()), receive: '1' } }));
    expect(q.amountOut).toBe('1.000000');
    expect(same.rows.map((r) => r.receivesMore)).toEqual([false, false]);
    // Bring in: THORChain delivers BCH, the atom route PUSD; the page cannot compare without a price.
    const into = compareRoutes(input({ flow: IN, thor: thorFromIn(inQuote(), 8), atom: atom('quote-usdc-to-pusd.json') }));
    expect(into.rows.map((r) => [r.route, r.receiveSymbol, r.receivesMore])).toEqual([['thorchain', 'BCH', false], ['atom', 'PUSD', false]]);
    expect(into.rows[0]!.seconds).toEqual({ median: null, count: 0, estimate: 30 });
    // This flow's user lock returns after a number of seconds; the time shown is still the measured median.
    const usdc = atom('quote-usdc-to-pusd.json');
    expect(usdc.trust.userLockReturnsAfter).toMatchObject({ chain: 'base' });
    expect(into.rows[1]!.seconds).toEqual({ median: usdc.measured.medianSeconds, count: usdc.measured.count });
  });

  it('shows a refused atom quote as unavailable with its reason', () => {
    const c = compareRoutes(input({ atom: atom('quote-pusd-to-usdc-inventory.json') }));
    expect(c.rows[1]).toMatchObject({ route: 'atom', available: false, reason: 'inventory', receive: null, receivesMore: false });
    expect(c.rows[0]!.receivesMore).toBe(false);
  });

  it('marks an atom quote for another amount or flow as unavailable instead of comparing it', () => {
    expect(compareRoutes(input({ flow: { ...OUT, amount: '2' } })).rows[1]).toMatchObject({ available: false, reason: 'stale' });
    expect(compareRoutes(input({ flow: { ...OUT, amount: '1.0' } })).rows[1]!.available).toBe(true);
    expect(compareRoutes(input({ atom: atom('quote-usdc-to-pusd.json') })).rows[1]).toMatchObject({ available: false, reason: 'wrong-flow' });
  });

  it('has no atom row for BCH, for a flow not offered, or when the atom route is not shown', () => {
    expect(compareRoutes(input({ flow: { ...OUT, source: 'BCH' } })).rows.map((r) => r.route)).toEqual(['thorchain']);
    expect(compareRoutes(input({ config: { ...config, atomFlows: ['usdc-to-pusd'] } })).rows).toHaveLength(1);
    expect(compareRoutes(input({ config: { ...config, atomFlows: [] } })).rows).toHaveLength(1);
    expect(compareRoutes(input({ atom: null })).rows).toHaveLength(1);
  });

  it('keeps a THORChain error as an unavailable row with its code', () => {
    const c = compareRoutes(input({ thor: { error: 'route_paused' } }));
    expect(c.rows[0]).toMatchObject({ route: 'thorchain', available: false, reason: 'route_paused', receive: null });
    expect(c.rows.map((r) => r.receivesMore)).toEqual([false, false]);
    expect(c.selected).toBe('thorchain');
  });

  it('reads the recorded health answer in the documented shape', () => {
    const h = json<{ ok: boolean; mainnet: boolean; chainId: number; atomLock: string }>('atom', 'health.json');
    expect(h).toMatchObject({ ok: true, mainnet: true, chainId: 8453 });
    expect(h.atomLock).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
