// THORChain swap memos, shared by the server (which adds the limit) and the page (which checks the memo before
// the wallet sees it). Pure. Memo shape: `=:ASSET:DESTINATION:LIMIT[/INTERVAL/QUANTITY]:AFFILIATE:FEE`.
// THORChain counts every asset in units of 1e8, whatever the asset's own decimals are.
import { binToHex, utf8ToBin } from '@bitauth/libauth';

export const THOR_DECIMALS = 8;
export const MEMO_MAX_BYTES = 80;
const SWAP_ACTIONS = new Set(['=', 's', 'swap']);
/** THORChain's documented short codes for whole assets (memos may use them instead of the full name); each one
 *  here was seen in a THORNode quote memo for that asset (BSC.BNB `s` and AVAX.AVAX `a` on 18 Nov 2026). */
const SHORT_CODES: Record<string, string> = { A: 'AVAX.AVAX', C: 'BCH.BCH', E: 'ETH.ETH', S: 'BSC.BNB' };

export interface SwapMemo {
  asset: string;
  destination: string;
  /** Lowest output THORChain may pay, in 1e8 units; 0 when the memo has none. */
  limit: bigint;
}

/** `BASE.USDC-0X8335…`: chain key, symbol and contract in the form THORChain names assets. */
export const thorAsset = (chain: string, symbol: string, contract?: string): string =>
  contract ? `${chain}.${symbol}-${contract.toUpperCase()}` : `${chain}.${symbol}`;

/** Destination for a BCH address: THORChain wants the cash address without its prefix. */
export const withoutPrefix = (address: string): string => address.slice(address.indexOf(':') + 1);

/** floor(expected × (1 − bps/10000)): the lowest output the memo accepts. */
export const limitFor = (expectedOut: bigint, slippageBps: number): bigint => (expectedOut * BigInt(10_000 - slippageBps)) / 10_000n;

export function parseSwapMemo(memo: string): SwapMemo | string {
  const parts = memo.split(':');
  if (parts.length < 3 || !SWAP_ACTIONS.has(parts[0]!.toLowerCase())) return 'not a swap memo';
  const lim = (parts[3] ?? '').split('/')[0] ?? '';
  if (lim !== '' && !/^[0-9]{1,30}$/.test(lim)) return 'the limit is not a whole number';
  return { asset: parts[1]!, destination: parts[2]!, limit: lim === '' ? 0n : BigInt(lim) };
}

/** The quote's memo with our own limit in place of whatever limit it carried (streaming fields are kept). */
export function withLimit(memo: string, limit: bigint): string {
  const parsed = parseSwapMemo(memo);
  if (typeof parsed === 'string') throw new Error(parsed);
  const parts = memo.split(':');
  const rest = (parts[3] ?? '').split('/').slice(1);
  parts[3] = [limit.toString(), ...rest].join('/');
  const out = parts.join(':').replace(/:+$/, '');
  if (utf8ToBin(out).length > MEMO_MAX_BYTES) throw new Error(`memo is longer than ${MEMO_MAX_BYTES} bytes`);
  return out;
}

/** OP_RETURN locking bytecode carrying the memo: OP_RETURN, then one push of the memo bytes. */
export function opReturnHex(memo: string): string {
  const bytes = utf8ToBin(memo);
  if (bytes.length === 0 || bytes.length > MEMO_MAX_BYTES) throw new Error(`memo must be 1 to ${MEMO_MAX_BYTES} bytes`);
  const push = bytes.length <= 75 ? [bytes.length] : [0x4c, bytes.length];
  return `6a${binToHex(Uint8Array.from(push))}${binToHex(bytes)}`;
}

/**
 * Does this memo send to what the user typed? THORChain may shorten the asset (`BASE.USDC` for the full
 * contract form), so the asset must be the expected one or its short form; the destination must match
 * exactly (case-insensitive for EVM hex); the limit must be at least the minimum the page showed.
 */
export function memoMatches(memo: string, want: { asset: string; destination: string; minOut: bigint }): string | true {
  const m = parseSwapMemo(memo);
  if (typeof m === 'string') return m;
  const short = want.asset.split('-')[0]!.toUpperCase();
  const named = m.asset.toUpperCase();
  if (named !== want.asset.toUpperCase() && named !== short && SHORT_CODES[named] !== want.asset.toUpperCase()) return 'the memo names another asset';
  const evm = /^0x[0-9a-f]{40}$/i.test(want.destination);
  const same = evm ? m.destination.toLowerCase() === want.destination.toLowerCase() : m.destination === want.destination;
  if (!same) return 'the memo pays another address';
  if (m.limit < want.minOut || m.limit === 0n) return 'the memo limit is below the minimum shown';
  return true;
}
