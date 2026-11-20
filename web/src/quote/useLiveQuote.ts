// One price request behind a panel: waits for a typing pause, drops answers to older requests, and asks again on each
// refresh tick. A refresh that fails keeps the last good price, whose "updated Ns ago" then keeps counting (K5P2).
import { useEffect, useRef, useState } from 'react';
import { ApiFailure } from '../../../core/client/api';

export type LiveQuote<Q> = { status: 'none' } | { status: 'loading' } | { status: 'ok'; quote: Q; at: number } | { status: 'error'; code: string };

export function useLiveQuote<Q>(key: string | null, ask: () => Promise<Q>, pauseMs: number, tick: number): LiveQuote<Q> {
  const [result, setResult] = useState<{ key: string; state: LiveQuote<Q> } | null>(null);
  const asker = useRef(ask);
  useEffect(() => {
    asker.current = ask;
  });
  useEffect(() => {
    if (key === null) return;
    let live = true;
    const timer = setTimeout(() => {
      asker
        .current()
        .then((quote) => live && setResult({ key, state: { status: 'ok', quote, at: Date.now() } }))
        .catch((e: unknown) => {
          if (!live) return;
          const failed: LiveQuote<Q> = { status: 'error', code: e instanceof ApiFailure ? e.code : 'error' };
          setResult((prev) => (prev?.key === key && prev.state.status === 'ok' ? prev : { key, state: failed }));
        });
    }, pauseMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, pauseMs, tick]);
  if (key === null) return { status: 'none' };
  return result?.key === key ? result.state : { status: 'loading' };
}
