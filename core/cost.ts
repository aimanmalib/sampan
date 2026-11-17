// The cost card shown above the button before anything is signed (Send out and Bring in). Pure: bigint, no I/O.
// Every number comes from the quote the transaction is built from: THORChain's own amounts give the BCH price (what
// the route pays for the satoshis it receives, or charges for the satoshis it sends), Cauldron's trade gives the
// pool fee and the price impact, and the stablecoins on both sides count as USD 1. No outside price is used.
// Amounts in USD are micro-dollars (1e-6). Parts add up to what is paid minus what is received, to the micro-dollar
// up to rounding; BCH that stays in the user's own wallet is listed apart and is not a cost.
import { poolFee } from './pools/math.js';
import type { SelectedTrade } from './pools/trade.js';

export const MICRO_PER_UNIT = 1_000_000n;
/** THORChain writes every amount with 8 decimals. */
const ROUTE_TO_MICRO = 100n;

export type CostPartKey =
  | 'bchNetwork'
  | 'poolFee'
  | 'impact'
  | 'sampanFee'
  | 'thorLiquidity'
  | 'thorOutbound'
  | 'thorAffiliate'
  | 'gas'
  | 'convertNetwork';

export interface CostPart {
  key: CostPartKey;
  usd: bigint;
}

export interface ThorFees {
  liquidity: bigint;
  outbound: bigint;
  affiliate: bigint;
  /** THORChain's own price impact of its swap. */
  slippageBps: number;
}

/** One Cauldron trade as the server quoted it. */
export interface CauldronStep {
  supply: bigint;
  demand: bigint;
  poolFeeSats: bigint;
  sampanFeeSats: bigint;
  impactBps: number;
}

export interface Timing {
  /** THORNode's own estimate for the whole swap. */
  routeSeconds: number;
  /** One block of the chain the deposit is made on. */
  sourceBlockSeconds: number;
  /** Seconds of the measured ok runs for this asset and direction (MEASURED.md). */
  measured: number[];
}

/** Gas on the source chain for a bring-in: units times the gas price, valued at the gas asset's price. */
export interface Gas {
  approve: boolean;
  approveUnits: bigint;
  depositUnits: bigint;
  priceWei: bigint;
  /** USD per whole gas coin, 8 decimals (THORChain pool price). */
  nativeUsdE8: bigint;
}

export interface CostCard {
  payUsd: bigint;
  receiveUsd: bigint;
  /** Sum of the parts. */
  totalUsd: bigint;
  /** BCH left in the user's own wallet (not a cost). */
  leftoverUsd: bigint;
  /** (receive + leftover) / pay, percent with two decimals. */
  keepPct: number;
  parts: CostPart[];
  impactBps: number;
  minutes: { from: number; to?: number };
  /** Unix seconds; nothing may be signed against the quote after this. */
  expiresAt: number;
  warn: { impact: boolean; cost: boolean };
}

export interface OutCostInput {
  /** True when the user pays the stablecoin (step 1 swaps it to BCH on Cauldron). */
  fromToken: boolean;
  /** Base units of the source: token units, or satoshis. */
  amount: bigint;
  tokenDecimals: number;
  swap?: CauldronStep & { networkSats: bigint };
  depositSats: bigint;
  depositNetworkSats: bigint;
  expectedOut: bigint;
  fees: ThorFees;
  expiry: number;
  timing: Timing;
  warnBps: number;
}

export interface InCostInput {
  /** Stablecoin paid, THORChain 1e8 units. */
  amount: bigint;
  expectedSats: bigint;
  fees: ThorFees;
  /** Present when the BCH lands at a landing address and is converted to the stablecoin there. */
  landing?: { swap: CauldronStep; convertFeeSats: bigint; tokenDustSats: bigint; tokenDecimals: number };
  /** Unknown gas (no price yet) leaves the part out; the page says gas is extra. */
  gas?: Gas;
  expiry: number;
  timing: Timing;
  warnBps: number;
}

const div = (a: bigint, b: bigint): bigint => (b === 0n ? 0n : a / b);
const tokenMicro = (units: bigint, decimals: number): bigint =>
  decimals <= 6 ? units * 10n ** BigInt(6 - decimals) : units / 10n ** BigInt(decimals - 6);

/** Price impact and pool fee of a Cauldron trade, from the pools' state before it (constant-product math). */
export function tradeCost(trade: SelectedTrade): { poolFeeSats: bigint; impactBps: number } {
  let fee = 0n;
  let ideal = 0n;
  let got = 0n;
  for (const leg of trade.legs) {
    const legFee = poolFee(leg.pool, leg.after);
    fee += legFee;
    if (trade.side === 'sell') {
      // Tokens in, BCH out: at the spot price the tokens would fetch supply * sats / tokens.
      ideal += div(leg.supply * leg.pool.sats, leg.pool.tokens);
      got += leg.demand + legFee;
    } else {
      // BCH in (less the pool fee), tokens out.
      ideal += div((leg.supply - legFee) * leg.pool.tokens, leg.pool.sats);
      got += leg.demand;
    }
  }
  const impact = ideal > got ? Number(div((ideal - got) * 10_000n, ideal)) : 0;
  return { poolFeeSats: fee, impactBps: impact };
}

/** "about A-B min": A from the route's estimate plus one source block, B the median of measured runs. */
export function costMinutes(t: Timing): { from: number; to?: number } {
  const a = Math.max(1, Math.ceil((t.routeSeconds + t.sourceBlockSeconds) / 60));
  if (t.measured.length === 0) return { from: a };
  const s = [...t.measured].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  const b = Math.max(1, Math.ceil(median / 60));
  if (a === b) return { from: a };
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

const thorParts = (f: ThorFees, toUsd: (v: bigint) => bigint): CostPart[] => [
  { key: 'thorLiquidity', usd: toUsd(f.liquidity) },
  { key: 'thorOutbound', usd: toUsd(f.outbound) },
  ...(f.affiliate > 0n ? [{ key: 'thorAffiliate' as const, usd: toUsd(f.affiliate) }] : []),
];

function card(o: {
  pay: bigint;
  receive: bigint;
  leftover: bigint;
  parts: CostPart[];
  impactBps: number;
  timing: Timing;
  expiry: number;
  warnBps: number;
}): CostCard {
  const parts = o.parts.filter((p) => p.usd !== 0n);
  const total = parts.reduce((s, p) => s + p.usd, 0n);
  const keepBps = Number(div((o.receive + o.leftover) * 10_000n, o.pay));
  return {
    payUsd: o.pay,
    receiveUsd: o.receive,
    totalUsd: total,
    leftoverUsd: o.leftover,
    keepPct: keepBps / 100,
    parts,
    impactBps: o.impactBps,
    minutes: costMinutes(o.timing),
    expiresAt: o.expiry,
    warn: { impact: o.impactBps > o.warnBps, cost: Number(div(total * 10_000n, o.pay)) > o.warnBps },
  };
}

export function outCost(i: OutCostInput): CostCard {
  const f = i.fees;
  // The route pays expectedOut plus its fees for depositSats: that is the BCH price of this quote.
  const gross = i.expectedOut + f.liquidity + f.outbound + f.affiliate;
  const satsUsd = (sats: bigint): bigint => div(sats * gross, i.depositSats * ROUTE_TO_MICRO);
  const routeUsd = (v: bigint): bigint => v / ROUTE_TO_MICRO;
  const receive = routeUsd(i.expectedOut);
  const parts: CostPart[] = [];
  let pay: bigint;
  let leftover = 0n;
  let impactBps = f.slippageBps;
  if (i.fromToken && i.swap) {
    const s = i.swap;
    pay = tokenMicro(i.amount, i.tokenDecimals);
    const network = s.networkSats + i.depositNetworkSats;
    const left = s.demand - s.sampanFeeSats - network - i.depositSats;
    leftover = satsUsd(left > 0n ? left : 0n);
    const poolFeeUsd = satsUsd(s.poolFeeSats);
    // What the swap gave, valued at THORChain's price, against what was paid: Cauldron's impact and price.
    const impactUsd = pay - satsUsd(s.demand) - poolFeeUsd;
    parts.push(
      { key: 'poolFee', usd: poolFeeUsd },
      { key: 'impact', usd: impactUsd },
      { key: 'sampanFee', usd: satsUsd(s.sampanFeeSats) },
      { key: 'bchNetwork', usd: satsUsd(network) },
    );
    impactBps += s.impactBps;
  } else {
    pay = satsUsd(i.amount + i.depositNetworkSats);
    parts.push({ key: 'bchNetwork', usd: satsUsd(i.depositNetworkSats) });
  }
  parts.push(...thorParts(f, routeUsd));
  return card({ pay, receive, leftover, parts, impactBps, timing: i.timing, expiry: i.expiry, warnBps: i.warnBps });
}

export function gasUsd(g: Gas): bigint {
  const units = (g.approve ? g.approveUnits : 0n) + g.depositUnits;
  // wei * USD(1e8) / 1e18 wei per coin -> micro-dollars.
  return div(units * g.priceWei * g.nativeUsdE8, 10n ** 18n * ROUTE_TO_MICRO);
}

export function inCost(i: InCostInput): CostCard {
  const f = i.fees;
  const stable = i.amount / ROUTE_TO_MICRO;
  // The route takes `amount` for expectedSats plus its fees (in satoshis): the BCH price of this quote.
  const gross = i.expectedSats + f.liquidity + f.outbound + f.affiliate;
  const satsUsd = (sats: bigint): bigint => div(sats * i.amount, gross * ROUTE_TO_MICRO);
  const gas = i.gas ? gasUsd(i.gas) : 0n;
  const parts: CostPart[] = [...thorParts(f, satsUsd), { key: 'gas', usd: gas }];
  let receive = satsUsd(i.expectedSats);
  let leftover = 0n;
  let impactBps = f.slippageBps;
  const l = i.landing;
  if (l) {
    receive = tokenMicro(l.swap.demand, l.tokenDecimals);
    leftover = satsUsd(i.expectedSats - l.swap.supply - l.convertFeeSats);
    const poolFeeUsd = satsUsd(l.swap.poolFeeSats);
    parts.push(
      { key: 'convertNetwork', usd: satsUsd(l.convertFeeSats) },
      { key: 'poolFee', usd: poolFeeUsd },
      { key: 'impact', usd: satsUsd(l.swap.supply) - poolFeeUsd - receive },
    );
    impactBps += l.swap.impactBps;
  }
  return card({ pay: stable + gas, receive, leftover, parts, impactBps, timing: i.timing, expiry: i.expiry, warnBps: i.warnBps });
}

/** Micro-dollars rounded half away from zero to `places` decimals (still in micro-dollars). */
export function roundMicro(micro: bigint, places: number): bigint {
  const step = 10n ** BigInt(6 - places);
  const v = micro < 0n ? -micro : micro;
  const r = ((v + step / 2n) / step) * step;
  return micro < 0n ? -r : r;
}

const fixed = (micro: bigint, places: number): string => {
  const r = roundMicro(micro, places);
  const v = r < 0n ? -r : r;
  const frac = ((v % MICRO_PER_UNIT) / 10n ** BigInt(6 - places)).toString().padStart(places, '0');
  return `${r < 0n ? '-' : ''}USD ${v / MICRO_PER_UNIT}.${frac}`;
};

/** USD from micro-dollars, rounded: two decimals, or four under one cent so a small fee does not read as 0. */
export function formatUsd(micro: bigint): string {
  const v = micro < 0n ? -micro : micro;
  return fixed(micro, v !== 0n && roundMicro(v, 2) < 10_000n ? 4 : 2);
}

export interface CardText {
  pay: string;
  receive: string;
  /** Absent when nothing (at the shown precision) stays in the wallet. */
  leftover?: string;
  total: string;
}

/**
 * The four headline amounts as shown, so that pay - receive - leftover = total on the screen, cent for cent: each
 * is rounded first and the total is the difference of the rounded amounts (it differs from the sum of the parts by
 * at most the rounding). Four decimals for all four when the cost is under one cent.
 */
export function cardText(c: CostCard): CardText {
  const abs = c.totalUsd < 0n ? -c.totalUsd : c.totalUsd;
  const places = abs !== 0n && roundMicro(abs, 2) < 10_000n ? 4 : 2;
  const pay = roundMicro(c.payUsd, places);
  const receive = roundMicro(c.receiveUsd, places);
  const leftover = roundMicro(c.leftoverUsd, places);
  return {
    pay: fixed(pay, places),
    receive: fixed(receive, places),
    ...(leftover > 0n ? { leftover: fixed(leftover, places) } : {}),
    total: fixed(pay - receive - leftover, places),
  };
}
