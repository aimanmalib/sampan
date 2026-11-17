// Compares the THORChain route with the atomic swap route for one amount. Pure: the page passes the two live quotes
// and the measured runs, and gets one row per route. Nothing here picks a route: the page keeps THORChain selected
// until the user chooses, and "receives more" is a fact label only when both rows can be compared.
import { formatUnits, parseUnits } from '../wallet.js';
import type { WireInQuote } from '../client/in.js';
import type { WireOutQuote } from '../client/out.js';
import type { Proof } from '../proof.js';

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

/** THORChain's Send out quote: received amount and fees in the destination asset. */
export const thorFromOut = (q: WireOutQuote): ThorSide => ({
  receive: formatUnits(BigInt(q.expectedOut), q.outDecimals),
  receiveSymbol: assetSymbol(q.asset),
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
  | { kind: 'locks'; userLockReturnsAfter: Wait; confirmations: { bch: number; base: number }; anyoneMaySettle: boolean };

export interface RouteRow {
  route: 'thorchain' | 'atom';
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
  /** True only on the row that receives more, when both rows are available in the same asset and differ. */
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
  proof: Proof;
  config: { token: string; atomFlows: readonly string[] };
}

/** The atom flow that serves this request, or null when the atom route has nothing to offer for it. */
export function atomFlowFor(flow: CompareFlow, token: string): AtomFlow | null {
  if (flow.chain !== ATOM_OTHER.chain || flow.symbol !== ATOM_OTHER.symbol) return null;
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

export function compareRoutes(input: CompareInput): Comparison {
  const rows = [thorRow(input)];
  const flow = atomFlowFor(input.flow, input.config.token);
  if (flow && input.atom && input.config.atomFlows.includes(flow)) rows.push(atomRow(input, flow, input.atom));
  const [a, b] = rows;
  if (a && b && a.available && b.available && a.receiveSymbol === b.receiveSymbol) {
    const x = units(a.receive ?? undefined);
    const y = units(b.receive ?? undefined);
    if (x !== undefined && y !== undefined && x !== y) (x > y ? a : b).receivesMore = true;
  }
  return { rows, selected: 'thorchain' };
}
