// core/route-facts.ts on frozen fixtures (no network), and the shape of docs/route-facts.json against docs/MEASURED.md.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRuns } from '../core/proof.js';
import { buildFacts, feeOf, liveRoutes, runsFor, signatureKey, timeOf, tradeParts, type RouteFacts, type RouteOffer, type SignatureCounts } from '../core/route-facts.js';

const BCH = (n: number): string => n.toString(16).padStart(64, 'a');
const EVM = (n: number): string => `0x${n.toString(16).padStart(64, 'b')}`;

const MEASURED = `# Measured

## Runs

| UTC | flow | amount | txid | seconds | result |
|---|---|---|---|---|---|
| 2026-11-15T12:00:00Z | swap | 0.001 BCH to at least 0.19 PUSD | ${BCH(1)} | 2.0 | ok |
| 2026-11-15T12:01:00Z | swap | 0.001 BCH to at least 0.19 PUSD | ${BCH(2)} | 4.0 | ok |
| 2026-11-15T12:02:00Z | swap | 0.4 PUSD to at least 0.0018 BCH | - | 0.8 | fail (Your wallet did not sign. Nothing was sent.) |
| 2026-11-15T12:03:00Z | swap | 0.001 BCH to at least 0.19 PUSD | ${BCH(3)} | 9.0 | ok |
| 2026-11-17T12:00:00Z | out | 1.8 PUSD to ETH.USDC (at least 1.4 USDC) | bch ${BCH(4)} · eth ${EVM(4)} | 300.0 | ok |
| 2026-11-17T12:30:00Z | out | 1.8 PUSD to ETH.USDC (at least 1.4 USDC) | bch ${BCH(14)} · eth ${EVM(14)} | 50.0 | fail (refunded by the route) |
| 2026-11-17T13:00:00Z | out | 2 PUSD to BSC.USDC (at least 1.6 USDC) | bch ${BCH(5)} · bsc ${EVM(5)} | 100.0 | ok |
| 2026-11-17T14:00:00Z | g3a | 2 ETH.USDC to PUSD (landing address) | bch ${BCH(6)} · eth ${EVM(6)} · convert ${BCH(7)} | 200.0 | ok |
| 2026-11-17T15:00:00Z | in | 1.8 ETH.USDC to PUSD (landing address) | bch ${BCH(8)} · eth ${EVM(8)} · convert ${BCH(9)} | 100.0 | ok |
| 2026-11-17T16:00:00Z | in | 1.6 AVAX.USDC to PUSD (landing address) | bch ${BCH(10)} · avax ${EVM(10)} · convert ${BCH(11)} | - | ok |
| 2026-11-18T10:00:00Z | oc-out | 0.0068 BCH to ETH.USDC | ${BCH(12)} | - | fail (refunded by the route) |
| 2026-11-18T11:00:00Z | oc-out | 0.0068 BCH to ETH.USDC | bch ${BCH(13)} · eth ${EVM(13)} | 2000.0 | ok |
`;

const OFFER: RouteOffer = {
  features: { swap: true, landing: true, oneClick: true },
  route: { active: 'thorchain' },
  thorchain: {
    assets: [
      { chain: 'ETH', symbol: 'USDC', live: { out: true, in: true } },
      { chain: 'BSC', symbol: 'USDC', live: { out: true, in: false } },
      { chain: 'BSC', symbol: 'USDT', live: { out: true, in: false } },
      { chain: 'AVAX', symbol: 'USDC', live: { out: false, in: true } },
      { chain: 'BASE', symbol: 'USDC', live: { out: false, in: false } },
    ],
  },
  oneClick: { assets: [{ chain: 'ETH', symbol: 'USDC', live: { out: true, in: false } }] },
};

const COUNTS: SignatureCounts = { swap: 1, land: 0, 'out:thorchain': 2, 'in:thorchain': 2, 'out:near-intents': 2, 'in:near-intents': 1 };

describe('route facts', () => {
  const runs = parseRuns(MEASURED);
  const routes = liveRoutes(OFFER);

  it('lists the live routes from config: one per flow, per chain and route for a crossing', () => {
    expect(routes.map((r) => r.id)).toEqual(['swap', 'land', 'out:thorchain:ETH', 'out:thorchain:BSC', 'out:near-intents:ETH', 'in:thorchain:ETH', 'in:thorchain:AVAX']);
    expect(routes.find((r) => r.id === 'out:thorchain:BSC')!.symbols).toEqual(['USDC', 'USDT']);
  });

  it('drops a flow or a route whose flag is off', () => {
    const off = liveRoutes({ ...OFFER, features: { swap: false, landing: true, oneClick: false }, route: { active: 'none' } });
    expect(off.map((r) => r.id)).toEqual(['land']);
  });

  it('times a route from its ok rows with a time, never a failed or untimed row', () => {
    expect(timeOf(routes[0]!, runs)).toEqual({ median_s: 4, n: 3, min_s: 2, max_s: 9, rows: [BCH(1), BCH(2), BCH(3)] });
    // The first THORChain bring-in was logged as g3a: it counts as `in` on its chain.
    expect(timeOf(routes.find((r) => r.id === 'in:thorchain:ETH')!, runs)).toMatchObject({ n: 2, median_s: 150, rows: [BCH(6), BCH(8)] });
    // The only AVAX row has no time: no time is shown rather than an estimate.
    expect(timeOf(routes.find((r) => r.id === 'in:thorchain:AVAX')!, runs)).toBeNull();
    // A 1Click run is never counted for THORChain on the same chain, and the reverse.
    expect(runsFor(routes.find((r) => r.id === 'out:thorchain:ETH')!, runs).map((r) => r.txid)).toEqual([BCH(4)]);
    expect(runsFor(routes.find((r) => r.id === 'out:near-intents:ETH')!, runs).map((r) => r.txid)).toEqual([BCH(13)]);
    expect(timeOf(routes.find((r) => r.id === 'land')!, runs)).toBeNull();
  });

  it('keeps the price difference apart from the fees', () => {
    const parts = [
      { key: 'poolFee', usd: 60_000n },
      { key: 'impact', usd: -220_000n },
      { key: 'thorOutbound', usd: 250_000n },
      { key: 'bchNetwork', usd: 4_000n },
    ];
    expect(feeOf(parts, 20, '2026-11-20T23:00:00.000Z', 'included')).toEqual({ usd: 0.31, pct: 1.57, impact_usd: -0.22, quoted_at: '2026-11-20T23:00:00.000Z', network: 'included' });
  });

  it('prices a Cauldron trade from its satoshis at its own rate', () => {
    const parts = tradeParts({ usdPerSat: 0.000003, payUsd: 20, poolFeeSats: 20_000n, sampanFeeSats: 0n, networkSats: 300n, impactBps: 5 });
    expect(parts).toEqual([
      { key: 'poolFee', usd: 60_000n },
      { key: 'sampanFee', usd: 0n },
      { key: 'bchNetwork', usd: 900n },
      { key: 'impact', usd: 10_000n },
    ]);
  });

  it('builds the file from counted signatures and refuses a route nobody counted', () => {
    const fee = { usd: null, reason: 'below the route minimum' } as const;
    const fees = Object.fromEntries(routes.map((r) => [r.id, { '2': fee, '20': fee, '100': fee }]));
    const facts = buildFacts({ routes, runs, signatures: { counted_at: '2026-11-20T23:14:08.185Z', counts: COUNTS }, fees, now: new Date('2026-11-20T23:20:00Z') });
    const land = facts.routes.find((r) => r.id === 'land')!;
    expect([land.signatures, land.payments, land.label]).toEqual([0, 1, 'land.source']);
    expect(facts.routes.find((r) => r.id === 'out:near-intents:ETH')!.signatures).toBe(2);
    expect(signatureKey(routes[2]!)).toBe('out:thorchain');
    const partial: Partial<SignatureCounts> = { ...COUNTS };
    delete partial['in:near-intents'];
    const withOneClickIn = liveRoutes({ ...OFFER, oneClick: { assets: [{ chain: 'ETH', symbol: 'USDC', live: { out: false, in: true } }] } });
    const allFees = Object.fromEntries(withOneClickIn.map((r) => [r.id, { '2': fee, '20': fee, '100': fee }]));
    expect(() => buildFacts({ routes: withOneClickIn, runs, signatures: { counted_at: 'x', counts: partial }, fees: allFees, now: new Date() })).toThrow(/in:near-intents/);
  });
});

describe('docs/route-facts.json', () => {
  const facts = JSON.parse(readFileSync('docs/route-facts.json', 'utf8')) as RouteFacts;
  const measured = readFileSync('docs/MEASURED.md', 'utf8').toLowerCase();

  it('names only transactions of the Runs table, and counts each one', () => {
    for (const r of facts.routes) {
      if (!r.time) continue;
      expect(r.time.n, r.id).toBe(r.time.rows.length);
      for (const id of r.time.rows) expect(measured, `${r.id} ${id}`).toContain(id.toLowerCase());
    }
  });

  it('gives each quoted fee its UTC time, and a reason for each missing one', () => {
    for (const r of facts.routes) {
      expect(Object.keys(r.fees).sort(), r.id).toEqual(['100', '2', '20']);
      for (const f of Object.values(r.fees)) {
        if (f.usd === null) expect(f.reason.trim(), r.id).not.toBe('');
        else expect(Number.isNaN(Date.parse(f.quoted_at)), r.id).toBe(false);
      }
    }
  });
});
