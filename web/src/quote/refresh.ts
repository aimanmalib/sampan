// The price on a panel asks again by itself every quote.autoRefreshMs (K5P2): one ticker for the whole page, counting
// only while the tab is visible and no dialog is open, so a price never changes under a wallet prompt. The review before
// signing is the one dialog marked data-live-quote: the price goes on refreshing under it and the review asks again.
import { useEffect, useState } from 'react';

/** True while a refresh must wait: the tab is hidden, or a modal dialog other than the review is open over the page. */
export function refreshBlocked(doc: Pick<Document, 'visibilityState' | 'querySelector'>): boolean {
  return doc.visibilityState === 'hidden' || doc.querySelector('dialog[open], [aria-modal="true"]:not([data-live-quote])') !== null;
}

type Listener = (tick: number) => void;
const listeners = new Map<Listener, number>();
let tick = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let period = 0;
let lastAt = 0;

function stop(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function fire(): void {
  lastAt = Date.now();
  tick += 1;
  for (const l of listeners.keys()) l(tick);
}

function arm(): void {
  stop();
  if (listeners.size === 0 || period === 0) return;
  timer = setTimeout(() => {
    timer = null;
    if (!refreshBlocked(document)) fire();
    else if (document.visibilityState === 'hidden') return; // resumes on visibilitychange
    arm();
  }, period);
}

function onVisible(): void {
  if (document.visibilityState !== 'visible') return stop();
  // Back on the tab: a price older than one period asks at once, then the ticker counts again.
  if (Date.now() - lastAt >= period && !refreshBlocked(document)) fire();
  arm();
}

function subscribe(l: Listener, ms: number): () => void {
  listeners.set(l, ms);
  period = Math.min(...listeners.values());
  if (listeners.size === 1) {
    lastAt = Date.now();
    document.addEventListener('visibilitychange', onVisible);
  }
  if (!timer) arm();
  return () => {
    listeners.delete(l);
    if (listeners.size > 0) return;
    document.removeEventListener('visibilitychange', onVisible);
    stop();
  };
}

/**
 * A number that goes up every `ms` while the tab is visible and no dialog is open; pass it to a quote hook so the
 * price asks again. 0 (and no timer) while `ms` is 0 or `active` is false (a swap being signed keeps its price).
 */
export function useRefreshTick(ms: number, active = true): number {
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    if (ms <= 0 || !active) return;
    return subscribe(setSeen, ms);
  }, [ms, active]);
  return ms > 0 && active ? seen : 0;
}
