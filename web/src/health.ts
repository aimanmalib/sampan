// GET /api/health, shared by the status line and the cross-chain tabs. One poller for the whole page while anything
// listens: it asks again every health.intervalSeconds (health.retrySeconds while something is not ok) and as soon as
// the tab becomes visible, so "Paused by the route" gives way to the form when the route reopens, without a reload.
import { useEffect, useState } from 'react';
import type { HealthReport } from '../../core/client/health';
import { api } from './api';
import { fetchConfig } from './config';

type Listener = (h: HealthReport) => void;

const listeners = new Set<Listener>();
let last: HealthReport | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

const allOk = (h: HealthReport | null): boolean =>
  h !== null && h.cauldron === true && h.bch === true && (h.route === null || h.route.open === true);

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (listeners.size === 0) return;
  fetchConfig()
    .then((c) => {
      if (listeners.size === 0 || timer) return;
      const seconds = allOk(last) ? c.health.intervalSeconds : c.health.retrySeconds;
      timer = setTimeout(poll, seconds * 1000);
    })
    .catch(() => undefined);
}

function poll(): void {
  timer = null;
  if (inFlight || listeners.size === 0) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return; // resumes on visibilitychange
  inFlight = true;
  api
    .get<HealthReport>('/api/health')
    .then((h) => {
      last = h;
      for (const l of listeners) l(h);
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight = false;
      schedule();
    });
}

function onVisible(): void {
  if (document.visibilityState === 'visible') poll();
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  if (last) l(last);
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', onVisible);
    poll();
  }
  return () => {
    listeners.delete(l);
    if (listeners.size > 0) return;
    document.removeEventListener('visibilitychange', onVisible);
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/** The server's last health check; null while loading or when it cannot be read. Updates while the page is open. */
export function useHealth(): HealthReport | null {
  const [health, setHealth] = useState<HealthReport | null>(last);
  useEffect(() => subscribe(setHealth), []);
  return health;
}
