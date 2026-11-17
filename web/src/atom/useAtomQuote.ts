// Live quote from the atomic swap service for one flow and amount. Nothing is requested unless features.atom is true
// and config.atom.flows offers that flow; the route is checked first (health, chain id, AtomLock in client and
// config), and a failed check or an unanswered quote leaves the route out (null) so THORChain works as before.
import { useEffect, useState } from 'react';
import type { AtomFlow, AtomQuote } from '../../../core/routes/compare';
import type { LoadedConfig } from '../config';
import type { AtomMakerApi } from './client';
import { checkAtomRoute } from './health';

/** Result of the route check: the service API when the route may be shown, null when it is left out. */
type Check = { api: AtomMakerApi | null };

/** True when this page may ask the atom service about `flow` at all. */
export const atomOffered = (config: Pick<LoadedConfig, 'features' | 'atom'>, flow: AtomFlow | null): flow is AtomFlow =>
  config.features.atom && flow !== null && config.atom.flows.includes(flow);

export function useAtomQuote(config: LoadedConfig, flow: AtomFlow | null, amount: string | null): AtomQuote | null {
  const offered = atomOffered(config, flow);
  const [check, setCheck] = useState<Check | null>(null);
  const [answer, setAnswer] = useState<{ key: string; quote: AtomQuote | null } | null>(null);

  // Checked once per mount, and only once the flow is offered; the answer stays for the life of the panel.
  useEffect(() => {
    if (!offered || check !== null) return;
    let live = true;
    void checkAtomRoute(config).then((r) => {
      if (live) setCheck({ api: r.show ? r.client.makerApi(config.atom.apiPath) : null });
    });
    return () => {
      live = false;
    };
  }, [offered, check, config]);

  const api = offered ? (check?.api ?? null) : null;
  const key = api !== null && amount !== null ? `${flow}:${amount}` : null;
  useEffect(() => {
    if (key === null || api === null || flow === null || amount === null) return;
    let live = true;
    const timer = setTimeout(() => {
      api
        .quote(flow, amount)
        .then((q) => live && setAnswer({ key, quote: q as unknown as AtomQuote }))
        .catch(() => {
          console.info('atom route hidden: quote');
          if (live) setAnswer({ key, quote: null });
        });
    }, config.atom.quotePauseMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, api, flow, amount, config.atom.quotePauseMs]);

  // The last answer stays while a new amount is quoted; the comparison marks it stale until the new one arrives.
  return api !== null && answer ? answer.quote : null;
}
