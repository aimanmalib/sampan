// Live "Send out" quote while the user types: waits for a pause and drops answers to older requests, and asks again on each refresh tick.
import { quoteOut, type WireOutQuote } from '../../../core/client/out';
import { api } from '../api';
import { useLiveQuote, type LiveQuote } from '../quote/useLiveQuote';

export type OutQuoteState = LiveQuote<WireOutQuote>;

export interface OutAsk {
  source: string;
  amount: bigint | undefined;
  symbol: string;
  chain: string;
  destination: string;
  /** 1Click asks for its own (dry) quote; absent = the active route. */
  route?: 'near-intents';
  /** False = ask nothing (the route is not offered for this request). */
  enabled?: boolean;
}

export function useOutQuote(ask: OutAsk, pauseMs: number, tick = 0): OutQuoteState {
  const { source, amount, symbol, chain, destination, route } = ask;
  const ready = ask.enabled !== false && amount !== undefined && amount > 0n && /^0x[0-9a-fA-F]{40}$/.test(destination);
  const key = ready ? `${route ?? ''}:${source}:${amount}:${symbol}:${chain}:${destination.toLowerCase()}` : null;
  return useLiveQuote(key, () => quoteOut(api, { source, amount: amount ?? 0n, symbol, chain, destination, ...(route ? { route } : {}) }), pauseMs, tick);
}
