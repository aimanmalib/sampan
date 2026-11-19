// One quote per listed network for "You keep" (ADR 0074): asked together after keepCompare.debounceMs without a new
// keystroke, through the same quote endpoints the panel uses; answers to an older request are dropped.
import { useEffect, useRef, useState } from 'react';
import { ApiFailure } from '../../../core/client/api';

export type QuoteState<Q> = { status: 'loading' } | { status: 'ok'; quote: Q } | { status: 'error'; code: string };

/**
 * `key` names the whole request (amount, addresses, the assets asked); null = ask nothing. `ask` is read when the
 * pause ends, so it may be a new function on every render.
 */
export function useKeepQuotes<Q>(key: string | null, assets: readonly string[], ask: (asset: string) => Promise<Q>, debounceMs: number): Record<string, QuoteState<Q>> {
  const [result, setResult] = useState<{ key: string; states: Record<string, QuoteState<Q>> } | null>(null);
  const latest = useRef({ ask, assets });
  useEffect(() => {
    latest.current = { ask, assets };
  });
  useEffect(() => {
    if (key === null) return;
    let live = true;
    const timer = setTimeout(() => {
      for (const asset of latest.current.assets) {
        latest.current
          .ask(asset)
          .then((quote): QuoteState<Q> => ({ status: 'ok', quote }))
          .catch((e: unknown): QuoteState<Q> => ({ status: 'error', code: e instanceof ApiFailure ? e.code : 'error' }))
          .then((state) => {
            if (!live) return;
            setResult((prev) => ({ key, states: { ...(prev?.key === key ? prev.states : {}), [asset]: state } }));
          });
      }
    }, debounceMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, debounceMs]);
  if (key === null) return {};
  const states = result?.key === key ? result.states : {};
  return Object.fromEntries(assets.map((a) => [a, states[a] ?? { status: 'loading' }]));
}
