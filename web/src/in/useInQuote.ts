// Live "Bring in" quote while the user types: waits for a pause and drops answers to older requests, and asks again on each refresh tick.
import { quoteIn, type WireInQuote } from '../../../core/client/in';
import { api } from '../api';
import { useLiveQuote, type LiveQuote } from '../quote/useLiveQuote';

export type InQuoteState = LiveQuote<WireInQuote>;

export interface InAsk {
  symbol: string;
  chain: string;
  amount: bigint | undefined;
  receive: string;
  address: string;
  addressOk: boolean;
  /** 1Click asks for its own (dry) quote; absent = the active route. */
  route?: 'near-intents';
  /** False = ask nothing (the route is not offered for this request). */
  enabled?: boolean;
}

export function useInQuote(ask: InAsk, pauseMs: number, tick = 0): InQuoteState {
  const { symbol, chain, amount, receive, address, addressOk, route } = ask;
  const key = ask.enabled !== false && amount !== undefined && amount > 0n && addressOk ? `${route ?? ''}:${symbol}:${chain}:${amount}:${receive}:${address}` : null;
  return useLiveQuote(key, () => quoteIn(api, { symbol, chain, amount: amount ?? 0n, receive, address, ...(route ? { route } : {}) }), pauseMs, tick);
}
