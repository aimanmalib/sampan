// Constant-product arithmetic of a Cauldron pool v0, written to match the on-chain check exactly.
// Pure: bigint only, no I/O. The contract accepts a spend when
//   (bch_after - fee) * tokens_after >= bch_before * tokens_before,  fee = |bch_after - bch_before| * 3 / 1000
// with integer division, so every function below rounds in the direction the contract requires.
import { POOL_V0_FEE_DENOMINATOR as FD, POOL_V0_FEE_NUMERATOR as FN } from './template.js';

export interface PoolState {
  sats: bigint;
  tokens: bigint;
}

const abs = (v: bigint): bigint => (v < 0n ? -v : v);
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

export const poolFee = (before: PoolState, after: PoolState): bigint => (abs(after.sats - before.sats) * FN) / FD;

/** The pool v0 exchange condition, evaluated the way the script evaluates it. */
export const poolAccepts = (before: PoolState, after: PoolState): boolean => {
  if (after.sats <= 0n || after.tokens <= 0n) return false;
  return (after.sats - poolFee(before, after)) * after.tokens >= before.sats * before.tokens;
};

const assertPositive = (v: bigint, what: string): void => {
  if (v <= 0n) throw new RangeError(`${what} must be positive`);
};

/** BCH in, tokens out: the most tokens the pool releases for `satsIn`. */
export const tokensOutForSats = (pool: PoolState, satsIn: bigint): bigint => {
  assertPositive(satsIn, 'satsIn');
  const effective = pool.sats + satsIn - (satsIn * FN) / FD;
  const tokensAfter = ceilDiv(pool.sats * pool.tokens, effective);
  return pool.tokens - tokensAfter;
};

/** BCH in, tokens out: the least BCH the pool needs to release `tokensOut`. */
export const satsInForTokens = (pool: PoolState, tokensOut: bigint): bigint => {
  assertPositive(tokensOut, 'tokensOut');
  if (tokensOut >= pool.tokens) throw new RangeError('pool does not hold that many tokens');
  const need = ceilDiv(pool.sats * pool.tokens, pool.tokens - tokensOut);
  const effective = (x: bigint): bigint => pool.sats + x - (x * FN) / FD;
  let x = ceilDiv((need - pool.sats) * FD, FD - FN);
  while (x > 1n && effective(x - 1n) >= need) x -= 1n;
  while (effective(x) < need) x += 1n;
  return x;
};

/** Tokens in, BCH out: the most BCH the pool releases for `tokensIn`. */
export const satsOutForTokens = (pool: PoolState, tokensIn: bigint): bigint => {
  assertPositive(tokensIn, 'tokensIn');
  const need = ceilDiv(pool.sats * pool.tokens, pool.tokens + tokensIn);
  const remaining = (d: bigint): bigint => pool.sats - d - (d * FN) / FD;
  let d = ((pool.sats - need) * FD) / (FD + FN);
  while (remaining(d + 1n) >= need) d += 1n;
  while (d > 0n && remaining(d) < need) d -= 1n;
  return d;
};

/** Tokens in, BCH out: the least tokens the pool needs to release `satsOut`. */
export const tokensInForSats = (pool: PoolState, satsOut: bigint): bigint => {
  assertPositive(satsOut, 'satsOut');
  const left = pool.sats - satsOut - (satsOut * FN) / FD;
  if (left <= 0n) throw new RangeError('pool does not hold that much BCH');
  return ceilDiv(pool.sats * pool.tokens, left) - pool.tokens;
};

/** Pool state after a trade where the pool receives `supply` and releases `demand`. */
export const poolAfter = (pool: PoolState, side: 'buy' | 'sell', supply: bigint, demand: bigint): PoolState =>
  side === 'buy'
    ? { sats: pool.sats + supply, tokens: pool.tokens - demand }
    : { sats: pool.sats - demand, tokens: pool.tokens + supply };
