// The line under the card's button (K6P5): what the chosen route takes, from docs/route-facts.json as it was when the
// page was built (virtual:sampan-route-facts): about the time over the measured runs, the signatures the e2e run
// counted, and the fee quoted at USD 20. A route with no fact draws nothing. The label links to the full table on /how;
// it says "quoted <UTC>" right after the fee, so "measured" never follows a quoted fee.
// `short`: the swap card's footer row (the first screen has no room for another line): fewer words and the label
// "time measured, fee quoted", whose full text (runs and quote time) is the link's accessible name.
import facts from 'virtual:sampan-route-facts';
import { factFor, fullLabel, lineLabel, lineParts, shortLabel, shortParts } from '../../../core/route-facts-text';
import { useText, type TextKey } from '../i18n';
import './facts.css';

/** `id`: `swap`, `land`, or `<out|in>:<route>:<chain key>`, as docs/route-facts.json names the route. */
export function RouteFactLine({ id, short = false }: { id: string; short?: boolean }) {
  const { t } = useText();
  const fact = factFor(facts, id);
  if (!fact) return null;
  const text = (key: string, vars?: Record<string, string>): string => t(key as TextKey, vars);
  const label = short ? shortLabel(fact, text) : lineLabel(fact, text);
  return (
    <p className={short ? 'facts__line facts__line--short' : 'facts__line'} data-route-fact={fact.id}>
      {(short ? shortParts(fact, text) : lineParts(fact, text)).join(' · ')}{' '}
      {label ? (
        <a href="/how#route-facts" aria-label={short ? fullLabel(fact, text) : undefined}>
          {label}
        </a>
      ) : null}
    </p>
  );
}
