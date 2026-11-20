// The 1Click row of "Choose a route" (ADR 0050): shown only for an asset config offers in that direction while the
// flag is on, compared with the other rows for the same amount, and unavailable (with its reason) when refused, still
// pending or quoted for another amount. Synthetic quotes; no network.
import { describe, expect, it } from 'vitest';
import { buildProof } from '../core/proof.js';
import { compareRoutes, thorFromOut, type AtomQuote, type CompareFlow, type CompareInput, type ThorSide } from '../core/routes/compare.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const atom = JSON.parse(readFileSync(path.resolve('tests/fixtures/atom/quote-pusd-to-usdc.json'), 'utf8')) as AtomQuote;
const OUT: CompareFlow = { kind: 'out', amount: '1', source: 'PUSD', chain: 'BASE', symbol: 'USDC' };
const IN: CompareFlow = { kind: 'in', amount: '2', chain: 'BASE', symbol: 'USDC', receive: 'BCH' };
const thor: ThorSide = { receive: '0.80', receiveSymbol: 'USDC', fees: { total: '0.20', totalBps: 2000 }, seconds: 900 };
const oc: ThorSide = { amount: '1', receive: '0.95', receiveSymbol: 'USDC', fees: { total: '0.02', totalBps: 206 }, seconds: 60 };
const offer = {
  assets: [
    { chain: 'BASE', symbol: 'USDC', live: { out: true, in: true } },
    { chain: 'ETH', symbol: 'USDC', live: { out: true, in: false } },
  ],
  deadlineMinutes: { out: 30, in: 60 },
};
const input = (o: Partial<CompareInput> = {}, enabled = true): CompareInput => ({
  flow: OUT,
  thor,
  atom: null,
  oneClick: oc,
  proof: buildProof(''),
  config: { token: 'PUSD', atomFlows: [], oneClick: { enabled, offer } },
  ...o,
});

describe('route comparison with 1Click', () => {
  it('names the received symbol the page picked, since a 1Click asset id does not carry it', () => {
    const q = {
      source: 'BCH', amount: '1000000', usd: 1, route: 'near-intents', sats: '1000000', vault: 'bitcoincash:q', memo: '',
      asset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', destination: '0x', expectedOut: '1380000',
      minOut: '1360000', outDecimals: 6, fees: { total: '300000', totalBps: 1786 }, expiry: 0, seconds: 120,
    };
    expect(thorFromOut(q, 'USDC')).toMatchObject({ receive: '1.38', receiveSymbol: 'USDC', fees: { total: '0.3', totalBps: 1786 } });
  });

  it('takes the 1Click time from its own oc-out and oc-in runs, not from the THORChain runs', () => {
    const tx = (n: number) => String(n).repeat(64);
    const md = [
      '| UTC | flow | amount | txid | seconds | result |',
      '|---|---|---|---|---|---|',
      `| 2026-01-01T00:00:00Z | oc-out | 1 BCH to ETH.USDC | bch ${tx(1)} · eth 0x${tx(2)} | 100.0 | ok |`,
      `| 2026-01-01T00:01:00Z | oc-out | 1 BCH to BASE.USDC | bch ${tx(3)} · base 0x${tx(4)} | 300.0 | ok |`,
      `| 2026-01-01T00:02:00Z | oc-in | 1 ETH.USDC to PUSD | bch ${tx(5)} · eth 0x${tx(6)} | 50.0 | ok |`,
      `| 2026-01-01T00:03:00Z | out | 1 PUSD to ETH.USDC | bch ${tx(7)} · eth 0x${tx(8)} | 900.0 | ok |`,
    ].join('\n');
    const proof = buildProof(md);
    expect(compareRoutes(input({ proof })).rows[1]!.seconds).toMatchObject({ median: 200, count: 2 });
    expect(compareRoutes(input({ proof })).rows[0]!.seconds).toMatchObject({ median: 900, count: 1 });
    const inRow = compareRoutes(input({ proof, flow: IN, thor: { ...thor, receiveSymbol: 'BCH' }, oneClick: { ...oc, amount: '2', receiveSymbol: 'BCH' } })).rows[1]!;
    expect(inRow.seconds).toMatchObject({ median: 50, count: 1 });
  });

  it('adds a 1Click row next to THORChain, with its fee, its own estimate apart and its deadline', () => {
    const c = compareRoutes(input());
    expect(c.selected).toBe('thorchain');
    expect(c.rows.map((r) => r.route)).toEqual(['thorchain', 'near-intents']);
    expect(c.rows[1]).toMatchObject({
      route: 'near-intents',
      available: true,
      receive: '0.95',
      receiveSymbol: 'USDC',
      fees: { total: '0.02', totalBps: 206 },
      seconds: { median: null, count: 0, estimate: 60 },
      trust: { kind: 'deposit', deadlineMinutes: 30 },
      receivesMore: true,
    });
    expect(compareRoutes(input({ flow: IN, thor: { ...thor, receiveSymbol: 'BCH' }, oneClick: { ...oc, amount: '2', receiveSymbol: 'BCH' } })).rows[1]!.trust).toEqual({
      kind: 'deposit',
      deadlineMinutes: 60,
    });
  });

  it('shows a refused or pending 1Click quote as unavailable with its code, and compares nothing with it', () => {
    const refused = compareRoutes(input({ oneClick: { error: 'below_route_min' } }));
    expect(refused.rows[1]).toMatchObject({ route: 'near-intents', available: false, reason: 'below_route_min', receive: null, receivesMore: false });
    expect(refused.rows[0]!.receivesMore).toBe(false);
    expect(compareRoutes(input({ oneClick: { error: 'pending' } })).rows[1]).toMatchObject({ available: false, reason: 'pending' });
  });

  it('marks a 1Click quote for another amount as stale', () => {
    const c = compareRoutes(input({ oneClick: { ...oc, amount: '0.5' } }));
    expect(c.rows[1]).toMatchObject({ available: false, reason: 'stale', receive: null });
    expect(c.rows.map((r) => r.receivesMore)).toEqual([false, false]);
  });

  it('has no 1Click row for an asset not offered in that direction, with the flag off, or when not asked', () => {
    expect(compareRoutes(input({ flow: { ...OUT, symbol: 'USDT' } })).rows).toHaveLength(1);
    expect(compareRoutes(input({ flow: { ...IN, chain: 'ETH' } })).rows).toHaveLength(1);
    expect(compareRoutes(input({}, false)).rows).toHaveLength(1);
    expect(compareRoutes(input({ oneClick: null })).rows).toHaveLength(1);
    expect(compareRoutes({ ...input(), config: { token: 'PUSD', atomFlows: [] } }).rows).toHaveLength(1);
  });

  it('labels only the one row that receives the most among three, and none on a tie for the most', () => {
    const three = input({ atom, config: { token: 'PUSD', atomFlows: ['pusd-to-usdc'], oneClick: { enabled: true, offer } } });
    const c = compareRoutes(three);
    expect(c.rows.map((r) => r.route)).toEqual(['thorchain', 'atom', 'near-intents']);
    const top = [...c.rows].sort((a, b) => Number(b.receive) - Number(a.receive))[0]!;
    expect(c.rows.filter((r) => r.receivesMore)).toEqual([top]);
    const tie = compareRoutes({ ...three, thor: { ...thor, receive: top.receive! }, oneClick: { ...oc, receive: top.receive! } });
    expect(tie.rows.some((r) => r.receivesMore)).toBe(false);
  });
});
