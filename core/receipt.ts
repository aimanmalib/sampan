// The receipt on a finished crossing's page (/c/:id): every transaction of the crossing, what went into the route and
// what came out, what that cost and the time it took. Pure: bigint, no I/O. Amounts are THORChain's (8 decimals for
// every asset); USD are micro-dollars. The stablecoins count as USD 1; BCH is valued at the price of the quote the
// crossing was built from (the same rule as the cost card, core/cost.ts), so no outside price is used.
import { MICRO_PER_UNIT } from './cost.js';

export const BCH_ROUTE_ASSET = 'BCH.BCH';
/** THORChain writes every amount with 8 decimals: 1e8 units to micro-dollars. */
const ROUTE_TO_MICRO = 100n;

export interface RouteCoin {
  asset: string;
  amount: bigint;
}

/** One transaction of the crossing. `chain` as the route names it: BCH, THOR, or an EVM chain key (ETH, BASE, …). */
export interface ReceiptLeg {
  chain: string;
  txid: string;
}

/** Micro-dollars per satoshi as a fraction: usd = sats * num / den. */
export interface BchPrice {
  num: bigint;
  den: bigint;
}

export interface Receipt {
  legs: ReceiptLeg[];
  refunded: boolean;
  paid: RouteCoin | null;
  received: RouteCoin | null;
  paidUsd: bigint | null;
  receivedUsd: bigint | null;
  costUsd: bigint | null;
  /** received / paid in USD, two decimals. */
  keepPct: number | null;
  seconds: number | null;
}

const big = (v: unknown): bigint | null => (typeof v === 'string' && /^[0-9]{1,30}$/.test(v) ? BigInt(v) : typeof v === 'bigint' && v >= 0n ? v : null);

/**
 * The BCH price of the quote a crossing was built from, as the route priced it (what it pays, fees included, for
 * the satoshis it receives; or what it charges, fees included, for the satoshis it sends). Null when the quote is
 * gone or not THORChain's shape.
 */
export function bchPriceOf(kind: 'out' | 'in', quote: Record<string, unknown> | null | undefined): BchPrice | null {
  if (!quote) return null;
  const f = (quote.fees ?? {}) as Record<string, unknown>;
  const fees = (big(f.liquidity) ?? 0n) + (big(f.outbound) ?? 0n) + (big(f.affiliate) ?? 0n);
  if (kind === 'out') {
    const sats = big(quote.sats);
    const out = big(quote.expectedOut);
    const decimals = typeof quote.outDecimals === 'number' && Number.isInteger(quote.outDecimals) ? quote.outDecimals : 8;
    if (!sats || out === null) return null;
    return { num: (out + fees) * MICRO_PER_UNIT, den: sats * 10n ** BigInt(decimals) };
  }
  const amount = big(quote.amount);
  const sats = big(quote.expectedSats);
  if (!amount || !sats) return null;
  return { num: amount, den: (sats + fees) * ROUTE_TO_MICRO };
}

export interface ReceiptInput {
  kind: 'out' | 'in';
  legs: ReceiptLeg[];
  refunded: boolean;
  paid?: RouteCoin;
  received?: RouteCoin;
  price: BchPrice | null;
  /** True for a stablecoin the site carries (route form, e.g. ETH.USDC-0X…). */
  stable: (asset: string) => boolean;
  seconds: number | null;
}

const div = (a: bigint, b: bigint): bigint => (b === 0n ? 0n : a / b);

export function receiptOf(i: ReceiptInput): Receipt {
  const isBch = (c?: RouteCoin): boolean => c?.asset === BCH_ROUTE_ASSET;
  const isStable = (c?: RouteCoin): boolean => !!c && i.stable(c.asset);
  // What goes in and comes out must be what this kind of crossing moves; anything else is not valued or shown.
  const paidOk = i.kind === 'out' ? isBch(i.paid) : isStable(i.paid);
  const back = i.refunded ? i.received?.asset === i.paid?.asset : i.kind === 'out' ? isStable(i.received) : isBch(i.received);
  const paid = paidOk ? i.paid! : null;
  const received = paidOk && back ? i.received! : null;
  const usd = (c: RouteCoin | null): bigint | null => {
    if (!c) return null;
    if (c.asset === BCH_ROUTE_ASSET) return i.price ? div(c.amount * i.price.num, i.price.den) : null;
    return c.amount / ROUTE_TO_MICRO;
  };
  const paidUsd = usd(paid);
  const receivedUsd = usd(received);
  const both = paidUsd !== null && receivedUsd !== null && paidUsd > 0n;
  return {
    legs: i.legs.filter((l) => l.txid !== ''),
    refunded: i.refunded,
    paid,
    received,
    paidUsd,
    receivedUsd,
    costUsd: both ? paidUsd - receivedUsd : null,
    keepPct: both ? Number(div(receivedUsd * 10_000n, paidUsd)) / 100 : null,
    seconds: i.seconds,
  };
}

/** A route amount (8 decimals) as text: trailing zeros dropped, at least `min` decimals. */
export function routeAmount(amount: bigint, min = 0): string {
  const whole = amount / 100_000_000n;
  let frac = (amount % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  if (frac.length < min) frac = frac.padEnd(min, '0');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** The symbol of a route asset: BCH.BCH → BCH, ETH.USDC-0XA0B8… → USDC. */
export const routeSymbol = (asset: string): string => (asset.split('.')[1] ?? asset).split('-')[0]!;
