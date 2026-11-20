// "Measured" card. With config measured.source "proof" (the default) the headline is counted from docs/MEASURED.md when the
// page is built, by the same counter as the README bounty table, and this server's own records (/api/stats) follow as a
// small second line; "stats" shows the server's records only. Rows made from the team's wallets are counted in the
// server total but never as other people's; that part is hidden while it is zero.
import { useEffect, useState } from 'react';
import { headline } from 'virtual:sampan-proof';
import { api } from './api';
import { headlineParts, measuredParts, type Stats } from '../../core/client/measured';
import { useConfig } from './config';
import { useText } from './i18n';

/** "USDC and USDT" in the page's language; a plain comma list where the browser has no list formatter. */
function listIn(lang: string): (items: string[]) => string {
  try {
    const format = new Intl.ListFormat(lang, { type: 'conjunction' });
    return (items) => format.format(items);
  } catch {
    return (items) => items.join(', ');
  }
}

/** `link`: a link to the proof table on /how (front page). */
export function Measured({ link = false }: { link?: boolean }) {
  const { lang, t } = useText();
  const config = useConfig();
  const proof = (config?.measured?.source ?? 'proof') === 'proof';
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let live = true;
    api
      .get<Stats>('/api/stats')
      .then((s) => live && setStats(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!proof && !stats) return null;
  // Under the proof headline the server line is extra, so it waits until this server has completed something.
  const server = stats && (!proof || stats.all.completed > 0) ? measuredParts(stats, t).join(' · ') : null;
  return (
    <section className="measured" aria-labelledby="measured-title">
      <h2 className="measured__title" id="measured-title">
        {t('measured.title')}
      </h2>
      {proof ? (
        <p className="measured__headline" data-crossings={headline.crossings}>
          {headlineParts(headline, t, listIn(lang)).join(' · ')}
        </p>
      ) : null}
      {server ? (
        <p className={proof ? 'measured__line measured__line--small' : 'measured__line'}>
          {proof ? t('measured.server', { line: server }) : server}
        </p>
      ) : null}
      {link ? (
        <p className="measured__how">
          <a href="/how#proof">{t(proof ? 'measured.see' : 'measured.how')}</a>
        </p>
      ) : null}
    </section>
  );
}
