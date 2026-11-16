// Pricing of one invoice. Pure. The invoice is in USD; the merchant receives the PUSD equivalent (1 PUSD per USD),
// and the contract floor of the invoice address is exactly that many token units for a payment of requiredSats.
import { LANDING_RATE_DEN } from '../landing.js';

/** USD with at most `decimals` decimals as token base units, or a reason. */
export function usdToTokens(usd: number, decimals: number): bigint | string {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return 'usd must be a positive number';
  const scaled = usd * 10 ** decimals;
  const units = Math.round(scaled);
  if (Math.abs(units - scaled) > 1e-6) return `usd must have at most ${decimals} decimals`;
  return BigInt(units);
}

export interface RequiredSatsInput {
  /** Satoshis the pools ask today for the invoice's tokens (a buy trade targeting the token amount). */
  tradeSats: bigint;
  bufferBps: number;
  /** Miner fee of the convert transaction and the dust kept on its token output (config landing.*). */
  convertFeeSats: number;
  tokenDustSats: number;
  /** Sampan's spread on the trade (pay.spreadBps); 0 or absent asks exactly what it asked before the spread existed. */
  spreadBps?: number;
}

/** Satoshis `bps` basis points of `sats` come to, rounded up. */
export const bpsOf = (sats: bigint, bps: number): bigint => (sats * BigInt(bps) + 9_999n) / 10_000n;

/**
 * What the payer is asked to send: the trade with a margin, plus what the convert transaction spends on itself,
 * plus the spread. The contract floor stays the invoice's tokens, so the spread is BCH left over after the convert.
 */
export function requiredSatsFor(i: RequiredSatsInput): bigint {
  if (i.tradeSats <= 0n) throw new RangeError('tradeSats must be positive');
  const buffered = (i.tradeSats * BigInt(10_000 + i.bufferBps) + 9_999n) / 10_000n;
  return buffered + BigInt(i.convertFeeSats) + BigInt(i.tokenDustSats) + bpsOf(i.tradeSats, i.spreadBps ?? 0);
}

/**
 * Contract rate of an invoice address: rateDen = 100000000 + nonce gives the address its own hash. rateNum is
 * rounded down, so for a payment of requiredSats (below one BCH, see pay.maxUsd) the contract floor
 * ceil(requiredSats * rateNum / rateDen) is exactly `tokens`: rounding up would ask the pools for one unit more.
 */
export function invoiceRate(tokens: bigint, requiredSats: bigint, nonce: number): { rateNum: bigint; rateDen: bigint } {
  if (tokens <= 0n || requiredSats <= 0n) throw new RangeError('tokens and requiredSats must be positive');
  if (!Number.isInteger(nonce) || nonce < 1) throw new RangeError('nonce must be a positive integer');
  const rateDen = LANDING_RATE_DEN + BigInt(nonce);
  return { rateNum: (tokens * rateDen) / requiredSats, rateDen };
}

/** Satoshis as a BCH decimal string without trailing zeros (BIP21 amount). */
export function satsToBch(sats: bigint): string {
  const whole = sats / 100_000_000n;
  const frac = (sats % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** BIP21 payment URI for a plain address and an amount. */
export const bip21 = (address: string, sats: bigint): string => `${address}?amount=${satsToBch(sats)}`;
