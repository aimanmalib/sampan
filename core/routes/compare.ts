// Compares the routes for one amount: THORChain, the atomic swap route and 1Click (NEAR Intents). Pure: the page
// passes the live quotes and the measured runs, and gets one row per route it offers. Nothing here picks a route: the
// page keeps THORChain selected until the user chooses, and "receives more" is a fact label only when rows in the same
// asset can be compared.
import { formatUnits, parseUnits } from '../wallet.js';
import type { WireInQuote } from '../client/in.js';
import type { WireOutQuote } from '../client/out.js';
import type { Proof } from '../proof.js';
import { offersOneClick, type OneClickPublic } from '../oneclick-config.js';

/** The two flows the atomic swap service offers; each names its assets. */
export const ATOM_FLOWS = ['usdc-to-pusd', 'pusd-to-usdc'] as const;
export type AtomFlow = (typeof ATOM_FLOWS)[number];

/** The asset on the other chain for both atom flows. */
const ATOM_OTHER = { chain: 'base', symbol: 'USDC' } as const;

/** What the user asked for. `out` = Send out (BCH side is the source), `in` = Bring in (BCH side is what they get). */
export type CompareFlow =
  | { kind: 'out'; amount: string; source: string; chain: string; symbol: string }
  | { kind: 'in'; amount: string; chain: string; symbol: string; receive: string };

/** THORChain's side as the page already holds it, reduced to what a comparison needs. */
export interface ThorSide {
  /** Decimal amount the quote was asked for (in the source asset), when the page knows it: a different one is stale. */
  amount?: string;
  /** Decimal amount the user is expected to get, and its symbol. */
  receive: string;
  receiveSymbol: string;
  /** Fees as the route reports them (decimal, in `receiveSymbol`); absent when the quote carries none. */
  fees?: { total: string; totalBps: number };
  /** THORChain's own estimate, seconds. */
  seconds: number;
}

/** Symbol of a route asset such as BASE.USDC-0X8335…: the part between the chain and the contract. */
const assetSymbol = (asset: string): string => (asset.split('.')[1] ?? asset).split('-')[0] ?? asset;

/**
 * A Send out quote (THORChain's, or 1Click's in the same wire shape): received amount and fees in the destination
 * asset. `symbol`: the symbol the page picked; THORChain's asset name carries it, a 1Click asset id does not.
 */
export const thorFromOut = (q: WireOutQuote, symbol?: string): ThorSide => ({
  receive: formatUnits(BigInt(q.expectedOut), q.outDecimals),
  receiveSymbol: symbol ?? assetSymbol(q.asset),
  fees: { total: formatUnits(BigInt(q.fees.total), q.outDecimals), totalBps: q.fees.totalBps },
  seconds: q.seconds,
});

/** THORChain's Bring in quote: it delivers BCH (which a landing address may turn into a token afterwards). */
export const thorFromIn = (q: WireInQuote, decimals: number): ThorSide => ({
  receive: formatUnits(BigInt(q.expectedSats), decimals),
  receiveSymbol: 'BCH',
  seconds: q.seconds,
});

type FeeLeg = { chain: 'base'; gasUnits: number } | { chain: 'bch'; sats: number };
type Wait = { chain: 'base'; seconds: number } | { chain: 'bch'; blocks: number };

/** The answer of GET {apiPath}/quote, as documented by the atomic swap service. */
export interface AtomQuote {
  ok: boolean;
  reason?: string;
  flow: string;
  amountIn?: string;
  amountOut?: string;
  networkFees: { lock: FeeLeg; claim: FeeLeg };
  trust: {
    userLockReturnsAfter: Wait;
    makerLockReturnsAfter: Wait;
    confirmations: { bch: number; base: number };
    anyoneMaySettle: boolean;
  };
  measured: { count: number; medianSeconds: number | null };
}

export type RouteTrust =
  | { kind: 'vaults'; refundsToSender: true }
  /** 1Click: a one-time deposit address from the quote; not filled before the deadline = refunded to your own address. */
  | { kind: 'deposit'; deadlineMinutes: number }
  | { kind: 'locks'; userLockReturnsAfter: Wait; confirmations: { bch: number; base: number }; anyoneMaySettle: boolean };

export interface RouteRow {
  route: 'thorchain' | 'atom' | 'near-intents';
  available: boolean;
  /** Why the row cannot be chosen now, as a short code the page translates. */
  reason?: string;
  receive: string | null;
  receiveSymbol: string;
  /** Fees exactly as each route reports them: THORChain in the received asset, atom in gas units or satoshis. */
  fees: { total: string; totalBps: number } | FeeLeg[] | null;
  /** Measured median and how many runs it rests on; `median` null = not measured yet. `estimate` = THORChain's own. */
  seconds: { median: number | null; count: number; estimate?: number };
  trust: RouteTrust;
  /** True only on the one row that receives the most, among available rows in the same asset, when they differ. */
  receivesMore: boolean;
}

export interface Comparison {
  rows: RouteRow[];
  /** Always THORChain: today's flow does not change unless the user picks another row. */
  selected: 'thorchain';
}

export interface CompareInput {
  flow: CompareFlow;
  /** The THORChain quote, or the error code the page already shows for it. */
  thor: ThorSide | { error: string };
  /** Null when the atom route is not shown at all (flag off, health check failed, quote did not answer). */
  atom: AtomQuote | null;
  /** 1Click's quote for the same request (same shape as THORChain's), or its error code; null when not asked. */
  oneClick?: ThorSide | { error: string } | null;
  proof: Proof;
  config: {
    token: string;
    atomFlows: readonly string[];
    /** features.oneClick and the 1Click block of /api/config; absent = the route is not offered. */
    oneClick?: { enabled: boolean; offer: Pick<OneClickPublic, 'assets' | 'deadlineMinutes'> };
  };
}

/** The atom flow that serves this request, or null when the atom route has nothing to offer for it. */
export function atomFlowFor(flow: CompareFlow, token: string): AtomFlow | null {
  // Config names chains in upper case (evm.chains[].key "BASE"); the atom service in lower case.
  if (flow.chain.toLowerCase() !== ATOM_OTHER.chain || flow.symbol !== ATOM_OTHER.symbol) return null;
  if (flow.kind === 'out') return flow.source === token ? 'pusd-to-usdc' : null;
  return flow.receive === token ? 'usdc-to-pusd' : null;
}

const SCALE = 18;
const units = (text: string | undefined): bigint | undefined => (text === undefined ? undefined : parseUnits(text, SCALE));

function thorRow(input: CompareInput): RouteRow {
  const ran = input.proof.flows.find((f) => f.flow === input.flow.kind);
  const measured = { median: ran?.medianSeconds ?? null, count: ran?.ok ?? 0 };
  const trust: RouteTrust = { kind: 'vaults', refundsToSender: true };
  const t = input.thor;
  if ('error' in t) {
    return { route: 'thorchain', available: false, reason: t.error, receive: null, receiveSymbol: '', fees: null, seconds: measured, trust, receivesMore: false };
  }
  return {
    route: 'thorchain',
    available: true,
    receive: t.receive,
    receiveSymbol: t.receiveSymbol,
    fees: t.fees ?? null,
    seconds: { ...measured, estimate: t.seconds },
    trust,
    receivesMore: false,
  };
}

function atomRow(input: CompareInput, flow: AtomFlow, q: AtomQuote): RouteRow {
  const receiveSymbol = flow === 'pusd-to-usdc' ? ATOM_OTHER.symbol : input.config.token;
  let reason = q.ok ? undefined : (q.reason ?? 'unavailable');
  if (q.flow !== flow) reason = 'wrong-flow';
  else if (q.ok && units(q.amountIn) !== units(input.flow.amount)) reason = 'stale';
  const available = reason === undefined;
  return {
    route: 'atom',
    available,
    ...(reason === undefined ? {} : { reason }),
    receive: available ? (q.amountOut ?? null) : null,
    receiveSymbol,
    fees: [q.networkFees.lock, q.networkFees.claim],
    seconds: { median: q.measured.medianSeconds, count: q.measured.count },
    trust: {
      kind: 'locks',
      userLockReturnsAfter: q.trust.userLockReturnsAfter,
      confirmations: q.trust.confirmations,
      anyoneMaySettle: q.trust.anyoneMaySettle,
    },
    receivesMore: false,
  };
}

/** The 1Click row: shown only for an asset config offers in this direction; its time is measured on its own runs. */
function oneClickRow(input: CompareInput, offer: Pick<OneClickPublic, 'deadlineMinutes'>, q: ThorSide | { error: string }): RouteRow {
  const ran = input.proof.flows.find((f) => (f.flow as string) === `oc-${input.flow.kind}`);
  const measured = { median: ran?.medianSeconds ?? null, count: ran?.ok ?? 0 };
  const trust: RouteTrust = { kind: 'deposit', deadlineMinutes: offer.deadlineMinutes[input.flow.kind] };
  let reason = 'error' in q ? q.error : undefined;
  if (reason === undefined && 'receive' in q && q.amount !== undefined && units(q.amount) !== units(input.flow.amount)) reason = 'stale';
  if (reason !== undefined || 'error' in q) {
    return { route: 'near-intents', available: false, reason: reason ?? 'unavailable', receive: null, receiveSymbol: '', fees: null, seconds: measured, trust, receivesMore: false };
  }
  return {
    route: 'near-intents',
    available: true,
    receive: q.receive,
    receiveSymbol: q.receiveSymbol,
    fees: q.fees ?? null,
    seconds: { ...measured, estimate: q.seconds },
    trust,
    receivesMore: false,
  };
}

/** Marks the one available row that receives the most, per received asset, when at least two rows can be compared. */
function markMost(rows: RouteRow[]): void {
  const open = rows.filter((r) => r.available && r.receive !== null);
  for (const symbol of new Set(open.map((r) => r.receiveSymbol))) {
    const same = open.filter((r) => r.receiveSymbol === symbol).map((r) => ({ r, v: units(r.receive ?? undefined) ?? -1n }));
    if (same.length < 2) continue;
    const top = same.reduce((a, b) => (b.v > a ? b.v : a), -1n);
    const best = same.filter((x) => x.v === top);
    if (best.length === 1) best[0]!.r.receivesMore = true;
  }
}

export function compareRoutes(input: CompareInput): Comparison {
  const rows = [thorRow(input)];
  const flow = atomFlowFor(input.flow, input.config.token);
  if (flow && input.atom && input.config.atomFlows.includes(flow)) rows.push(atomRow(input, flow, input.atom));
  const oc = input.config.oneClick;
  if (oc && input.oneClick && offersOneClick(oc.enabled, oc.offer, input.flow.kind, input.flow.chain, input.flow.symbol)) {
    rows.push(oneClickRow(input, oc.offer, input.oneClick));
  }
  markMost(rows);
  return { rows, selected: 'thorchain' };
}
