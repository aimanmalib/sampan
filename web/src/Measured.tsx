// "Measured" line: counts from the live server's own records (/api/stats). Rows made from the team's wallets are
// counted in the total but never as other people's; that part is hidden while it is zero.
import { useEffect, useState } from 'react';
import { api } from './api';
import { measuredParts, type Stats } from '../../core/client/measured';
import { useText } from './i18n';

export function Measured() {
  const { t } = useText();
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
  if (!stats) return null;
  return (
    <section className="measured" aria-labelledby="measured-title">
      <h2 className="measured__title" id="measured-title">
        {t('measured.title')}
      </h2>
      <p className="measured__line">{measuredParts(stats, t).join(' · ')}</p>
    </section>
  );
}
