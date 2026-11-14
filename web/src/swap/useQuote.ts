// Live quote while the user types: waits for a pause, drops answers that arrive after a newer request.
import { useEffect, useState } from 'react';
import { quoteSwap, type WireQuote } from '../../../core/client/swap';
import { ApiFailure } from '../../../core/client/api';
import type { TradeSide } from '../../../core/pools/trade';
import { api } from '../api';

export type QuoteState = { status: 'none' } | { status: 'loading' } | { status: 'ok'; quote: WireQuote } | { status: 'error'; code: string };

export function useQuote(token: string, side: TradeSide, amount: bigint | undefined, pauseMs: number): QuoteState {
  const key = amount !== undefined && amount > 0n ? `${token}:${side}:${amount}` : null;
  const [result, setResult] = useState<{ key: string; state: QuoteState } | null>(null);
  useEffect(() => {
    if (key === null || amount === undefined) return;
    let live = true;
    const timer = setTimeout(() => {
      quoteSwap(api, { token, side, amount })
        .then((quote) => live && setResult({ key, state: { status: 'ok', quote } }))
        .catch((e: unknown) => live && setResult({ key, state: { status: 'error', code: e instanceof ApiFailure ? e.code : 'error' } }));
    }, pauseMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, token, side, amount, pauseMs]);
  if (key === null) return { status: 'none' };
  return result?.key === key ? result.state : { status: 'loading' };
}
