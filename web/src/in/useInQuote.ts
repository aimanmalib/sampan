// Live "Bring in" quote while the user types: waits for a pause and drops answers to older requests.
import { useEffect, useState } from 'react';
import { ApiFailure } from '../../../core/client/api';
import { quoteIn, type WireInQuote } from '../../../core/client/in';
import { api } from '../api';

export type InQuoteState = { status: 'none' } | { status: 'loading' } | { status: 'ok'; quote: WireInQuote } | { status: 'error'; code: string };

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

export function useInQuote(ask: InAsk, pauseMs: number): InQuoteState {
  const { symbol, chain, amount, receive, address, addressOk, route } = ask;
  const key = ask.enabled !== false && amount !== undefined && amount > 0n && addressOk ? `${route ?? ''}:${symbol}:${chain}:${amount}:${receive}:${address}` : null;
  const [result, setResult] = useState<{ key: string; state: InQuoteState } | null>(null);
  useEffect(() => {
    if (key === null || amount === undefined) return;
    let live = true;
    const timer = setTimeout(() => {
      quoteIn(api, { symbol, chain, amount, receive, address, ...(route ? { route } : {}) })
        .then((quote) => live && setResult({ key, state: { status: 'ok', quote } }))
        .catch((e: unknown) => live && setResult({ key, state: { status: 'error', code: e instanceof ApiFailure ? e.code : 'error' } }));
    }, pauseMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, symbol, chain, amount, receive, address, route, pauseMs]);
  if (key === null) return { status: 'none' };
  return result?.key === key ? result.state : { status: 'loading' };
}
