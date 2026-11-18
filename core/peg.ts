// Pool depth and the PUSD peg, as pure arithmetic (bigint, no I/O). The pools' mid price is the PUSD the verified
// Cauldron pools hold per BCH, all pools taken together; the BCH dollar price is THORChain's own BCH.BCH pool
// (asset_tor_price), the price source the route already uses. PUSD counts as one dollar, so the gap between the two is
// how far PUSD sits from one dollar right now. No other price source is consulted.

export interface PegConfig {
  /** At or beyond this gap the swap, Send out, Bring in and landing panels show a warning. */
  warnBps: number;
  /** At or beyond this gap the server refuses new crossings and landing addresses (peg_off); swaps on BCH stay open. */
  refuseBps: number;
}

export type PegLevel = 'ok' | 'warn' | 'refuse' | 'unknown';

/** What GET /api/depth answers with; amounts as decimal strings (satoshis and token base units). */
export interface DepthReport {
  pools: number;
  /** BCH held by the counted pools, satoshis. */
  bch: string;
  /** Tokens held by the counted pools, in base units of `symbol`. */
  token: string;
  symbol: string;
  decimals: number;
  /** Tokens per BCH across the pools, 8 decimals (for PUSD: dollars per BCH). */
  midPriceE8: string;
  /** BCH that one trade can move through the pools taken together before its price is 1% worse than mid, fees aside. */
  onePercentBch: string;
  /** THORChain's USD per BCH, 8 decimals; null when THORNode did not answer. */
  bchUsdE8: string | null;
  /** PUSD in dollars minus one, in basis points (negative: under one dollar); null when the BCH price is unknown. */
  pegBps: number | null;
  peg: PegLevel;
  /** Unix milliseconds of the reading. */
  read: number;
  /** Where the numbers come from (the first configured indexer and THORNode), for the page to link. */
  sources: { pools: string; price: string | null };
}

const E8 = 100_000_000n;

export function validatePeg(p: PegConfig | undefined): string[] {
  const ok = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) < 10000;
  if (!p || !ok(p.warnBps) || !ok(p.refuseBps)) return ['peg.warnBps, peg.refuseBps: integers from 1 to 9999'];
  return p.warnBps < p.refuseBps ? [] : ['peg: warnBps must be below refuseBps'];
}

/** Tokens per whole BCH, 8 decimals. */
export const midPriceE8 = (sats: bigint, tokens: bigint, decimals: number): bigint => {
  if (sats <= 0n || tokens <= 0n) throw new RangeError('pools hold nothing');
  return (tokens * E8 * E8) / (10n ** BigInt(decimals) * sats);
};

/** Constant product: a trade of x against reserve X gets the price X/(X+x) of mid, so 1% worse at x = X/99. */
export const onePercentSats = (sats: bigint): bigint => sats / 99n;

/** (bchUsd / mid - 1) in basis points, rounded half away from zero. */
export const pegBpsOf = (midE8: bigint, bchUsdE8: bigint): number => {
  const num = (bchUsdE8 - midE8) * 20000n;
  const q = num / midE8;
  return Number(q >= 0n ? (q + 1n) / 2n : (q - 1n) / 2n);
};

export const pegLevelOf = (bps: number | null, c: PegConfig): PegLevel => {
  if (bps === null) return 'unknown';
  const gap = Math.abs(bps);
  if (gap >= c.refuseBps) return 'refuse';
  return gap >= c.warnBps ? 'warn' : 'ok';
};
