// The page's own check of a "bring in" plan before an EVM wallet is asked to sign: the memo must pay the BCH
// address this page chose (the user's own, or the landing address it recomputed), with a limit at least the
// minimum shown; the token, amount and expiry must be what was typed and still valid. Pure.
import { memoMatches, withoutPrefix } from '../routes/memo.js';
import type { RouterDeposit } from './calldata.js';

export interface InWant {
  /** Token contract the user picked on the source chain. */
  token: string;
  /** Amount typed, 1e8 units. */
  amount: bigint;
  /** BCH address (with or without prefix) that must receive the BCH. */
  destination: string;
  /** Smallest BCH output shown to the user, satoshis. */
  minSats: bigint;
  /** Unix seconds now. */
  now: number;
}

export function checkInPlan(d: RouterDeposit, want: InWant): true | string {
  if (d.token.toLowerCase() !== want.token.toLowerCase()) return 'the plan uses another token';
  if (d.amount !== want.amount) return 'the plan sends another amount';
  if (d.expiry <= want.now) return 'the quote has expired';
  if (!/^0x[0-9a-fA-F]{40}$/.test(d.router) || !/^0x[0-9a-fA-F]{40}$/.test(d.vault)) return 'the plan has no router or vault';
  const ok = memoMatches(d.memo, { asset: 'BCH.BCH', destination: withoutPrefix(want.destination), minOut: want.minSats });
  return ok === true ? true : ok;
}
