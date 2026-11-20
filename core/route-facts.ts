// What each live route of Sampan takes, measured (K6P5): the time from the ok rows of the Runs table that name a
// transaction, the signatures counted by the fake-wallet e2e run, and the fee at USD 2, 20 and 100 from quotes the
// server gave at a stated UTC time. docs/route-facts.json holds the result (tools/measure/route-facts.ts writes it);
// the page, /how and the READMEs read that one file. No data = null with a reason, never an estimate. Pure.
import { median, type ProofRun } from './proof.js';
import type { RouteId } from './config.js';

export type FlowKind = 'swap' | 'land' | 'out' | 'in';

/** The key a counted signature total is stored under: the flow, and for a crossing the route. */
export type SignatureKey = 'swap' | 'land' | `${'out' | 'in'}:${RouteId}`;
export type SignatureCounts = Record<SignatureKey, number>;

/** USD amounts the fee is quoted at, as strings so they stay the JSON keys. */
export const FEE_AMOUNTS = ['2', '20', '100'] as const;
export type FeeAmount = (typeof FEE_AMOUNTS)[number];

/**
 * `usd`: the fees the cost card names (pool, Sampan, network, route liquidity, outbound and affiliate, gas), not the
 * price difference. `impact_usd`: the price difference on its own, as the card counts it (negative when the pool
 * price was better than the route's). `network`: whether the network fees the person pays on their own chain are in
 * `usd` (the 1Click bring-in card and the landing payment leave them out, as the page does).
 */
export type Fee =
  | { usd: number; pct: number; impact_usd: number; quoted_at: string; network: 'included' | 'excluded' }
  | { usd: null; reason: string };

/** One named part of a cost card, in micro-USD (core/cost.ts CostPart). */
export interface FeePart {
  key: string;
  usd: bigint;
}

export interface RouteTime {
  median_s: number;
  n: number;
  min_s: number;
  max_s: number;
  /** BCH transaction id of each run counted, as MEASURED.md writes it. */
  rows: string[];
}

export interface RouteFact {
  /** `swap`, `land`, or `<out|in>:<route>:<chain key>`. */
  id: string;
  /** lang key of the flow's name (the tab or the landing). */
  label: string;
  flow: FlowKind;
  route: RouteId | null;
  chain: string | null;
  /** Stablecoins the route carries on this chain now (config), in config order; empty for swap and land. */
  symbols: string[];
  time: RouteTime | null;
  /** Signatures the person gives in Sampan, counted; a landing adds one payment from any BCH wallet. */
  signatures: number;
  payments: number;
  fees: Record<FeeAmount, Fee>;
}

export interface RouteFacts {
  generated_at: string;
  signatures_counted_at: string;
  routes: RouteFact[];
}

/** The live routes as config offers them: one per flow, and per chain and route for a crossing. */
export interface LiveRoute {
  id: string;
  flow: FlowKind;
  route: RouteId | null;
  chain: string | null;
  symbols: string[];
}

export interface RouteOffer {
  features: { swap: boolean; landing: boolean; oneClick: boolean };
  route: { active: string };
  thorchain: { assets: ReadonlyArray<{ chain: string; symbol: string; live: { out: boolean; in: boolean } }> };
  oneClick: { assets: ReadonlyArray<{ chain: string; symbol: string; live: { out: boolean; in: boolean } }> };
}

export const LABELS: Record<FlowKind, string> = { swap: 'tabs.swap', land: 'land.source', out: 'tabs.out', in: 'tabs.in' };

export function liveRoutes(c: RouteOffer): LiveRoute[] {
  const out: LiveRoute[] = [];
  if (c.features.swap) out.push({ id: 'swap', flow: 'swap', route: null, chain: null, symbols: [] });
  if (c.features.landing) out.push({ id: 'land', flow: 'land', route: null, chain: null, symbols: [] });
  const sources: Array<[RouteId, RouteOffer['thorchain']['assets']]> = [];
  if (c.route.active === 'thorchain') sources.push(['thorchain', c.thorchain.assets]);
  if (c.features.oneClick) sources.push(['near-intents', c.oneClick.assets]);
  for (const flow of ['out', 'in'] as const) {
    for (const [route, assets] of sources) {
      const chains = new Map<string, string[]>();
      for (const a of assets) if (a.live[flow]) chains.set(a.chain, [...(chains.get(a.chain) ?? []), a.symbol]);
      for (const [chain, symbols] of chains) out.push({ id: `${flow}:${route}:${chain}`, flow, route, chain, symbols });
    }
  }
  return out;
}

/** The Runs flows that measure a route: the THORChain bring-in logged first as `g3a` counts as `in`. */
function flowsOf(r: LiveRoute): string[] {
  if (r.flow === 'swap' || r.flow === 'land') return [r.flow];
  if (r.route === 'near-intents') return [`oc-${r.flow}`];
  return r.flow === 'in' ? ['in', 'g3a'] : ['out'];
}

/** The ok runs with a time and a BCH transaction id that measured this route. */
export function runsFor(r: LiveRoute, runs: readonly ProofRun[]): Array<{ seconds: number; txid: string }> {
  const flows = flowsOf(r);
  const chain = r.chain?.toLowerCase();
  const picked: Array<{ seconds: number; txid: string }> = [];
  for (const run of runs) {
    if (!run.ok || run.seconds === null || !flows.includes(run.flow)) continue;
    if (chain && !run.txids.some((t) => t.chain === chain)) continue;
    const bch = run.txids.find((t) => t.chain === 'bch');
    if (bch && !picked.some((p) => p.txid === bch.id)) picked.push({ seconds: run.seconds, txid: bch.id });
  }
  return picked;
}

export function timeOf(r: LiveRoute, runs: readonly ProofRun[]): RouteTime | null {
  const picked = runsFor(r, runs);
  if (picked.length === 0) return null;
  const s = picked.map((p) => p.seconds);
  return { median_s: median(s)!, n: picked.length, min_s: Math.min(...s), max_s: Math.max(...s), rows: picked.map((p) => p.txid) };
}

export const signatureKey = (r: LiveRoute): SignatureKey => (r.flow === 'swap' || r.flow === 'land' ? r.flow : `${r.flow}:${r.route!}`);

const cents = (micro: bigint): number => Math.round(Number(micro) / 1e4) / 100;

/** The fee and the price difference of one quote at `payUsd`, from the parts of its cost card. */
export function feeOf(parts: readonly FeePart[], payUsd: number, quotedAt: string, network: 'included' | 'excluded'): Fee {
  const sum = (impact: boolean): bigint => parts.filter((p) => (p.key === 'impact') === impact).reduce((t, p) => t + p.usd, 0n);
  const fee = sum(false);
  return { usd: cents(fee), pct: Math.round((Number(fee) / 1e6 / payUsd) * 10_000) / 100, impact_usd: cents(sum(true)), quoted_at: quotedAt, network };
}

/**
 * The parts of one Cauldron trade in micro-USD: pool fee, Sampan fee and the network fee in satoshis at the trade's
 * own price (USD per satoshi from what it receives), and the price impact on what is paid.
 */
export function tradeParts(t: { usdPerSat: number; payUsd: number; poolFeeSats: bigint; sampanFeeSats: bigint; networkSats: bigint; impactBps: number }): FeePart[] {
  const micro = (usd: number): bigint => BigInt(Math.round(usd * 1e6));
  return [
    { key: 'poolFee', usd: micro(Number(t.poolFeeSats) * t.usdPerSat) },
    { key: 'sampanFee', usd: micro(Number(t.sampanFeeSats) * t.usdPerSat) },
    { key: 'bchNetwork', usd: micro(Number(t.networkSats) * t.usdPerSat) },
    { key: 'impact', usd: micro((t.payUsd * t.impactBps) / 10_000) },
  ];
}

export function buildFacts(o: {
  routes: readonly LiveRoute[];
  runs: readonly ProofRun[];
  signatures: { counted_at: string; counts: Partial<SignatureCounts> };
  fees: Record<string, Record<FeeAmount, Fee>>;
  now: Date;
}): RouteFacts {
  return {
    generated_at: o.now.toISOString(),
    signatures_counted_at: o.signatures.counted_at,
    routes: o.routes.map((r) => {
      const signatures = o.signatures.counts[signatureKey(r)];
      if (typeof signatures !== 'number') throw new Error(`no counted signatures for ${signatureKey(r)}`);
      const fees = o.fees[r.id];
      if (!fees) throw new Error(`no fees for ${r.id}`);
      return {
        id: r.id,
        label: LABELS[r.flow],
        flow: r.flow,
        route: r.route,
        chain: r.chain,
        symbols: r.symbols,
        time: timeOf(r, o.runs),
        signatures,
        payments: r.flow === 'land' ? 1 : 0,
        fees,
      };
    }),
  };
}
