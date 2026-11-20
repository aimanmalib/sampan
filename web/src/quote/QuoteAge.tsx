// "Updated 3s ago" under a price that refreshes itself (K5P2). The visible count changes each second but is hidden
// from screen readers; they hear one short "Price updated at …" each time a new price arrives.
import { useEffect, useState } from 'react';
import { useText } from '../i18n';
import './quote.css';

export function QuoteAge({ at }: { at: number | null }) {
  const { t, lang } = useText();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [at]);
  if (at === null) return null;
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return (
    <p className="quote-age" data-quote-age={seconds} data-quote-at={at}>
      <span aria-hidden="true">{seconds < 1 ? t('quote.updatedNow') : t('quote.updated', { seconds: String(seconds) })}</span>
      <span className="visually-hidden" aria-live="polite">
        {t('quote.announce', { time: new Date(at).toLocaleTimeString(lang) })}
      </span>
    </p>
  );
}
