// Live "Send out" quote while the user types: waits for a pause and drops answers to older requests.
import { useEffect, useState } from 'react';
import { ApiFailure } from '../../../core/client/api';
import { quoteOut, type WireOutQuote } from '../../../core/client/out';
import { api } from '../api';

export type OutQuoteState = { status: 'none' } | { status: 'loading' } | { status: 'ok'; quote: WireOutQuote } | { status: 'error'; code: string };

export interface OutAsk {
  source: string;
  amount: bigint | undefined;
  symbol: string;
  chain: string;
  destination: string;
}

export function useOutQuote(ask: OutAsk, pauseMs: number): OutQuoteState {
  const { source, amount, symbol, chain, destination } = ask;
  const ready = amount !== undefined && amount > 0n && /^0x[0-9a-fA-F]{40}$/.test(destination);
  const key = ready ? `${source}:${amount}:${symbol}:${chain}:${destination.toLowerCase()}` : null;
  const [result, setResult] = useState<{ key: string; state: OutQuoteState } | null>(null);
  useEffect(() => {
    if (key === null || amount === undefined) return;
    let live = true;
    const timer = setTimeout(() => {
      quoteOut(api, { source, amount, symbol, chain, destination })
        .then((quote) => live && setResult({ key, state: { status: 'ok', quote } }))
        .catch((e: unknown) => live && setResult({ key, state: { status: 'error', code: e instanceof ApiFailure ? e.code : 'error' } }));
    }, pauseMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, source, amount, symbol, chain, destination, pauseMs]);
  if (key === null) return { status: 'none' };
  return result?.key === key ? result.state : { status: 'loading' };
}
