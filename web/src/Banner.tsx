import { useState } from 'react';
import { useConfig } from './config';
import { useText } from './i18n';

/** Event banner on every page. Links without a configured value are not shown. */
export function Banner() {
  const { t } = useText();
  const config = useConfig();
  const [copied, setCopied] = useState(false);
  const banner = config?.banner;

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="banner__inner">
      <strong className="banner__event">{t('banner.event')}</strong>
      {banner?.deckUrl ? <a href={banner.deckUrl}>{t('banner.presentation')}</a> : null}
      {banner?.repoUrl ? <a href={banner.repoUrl}>{t('banner.source')}</a> : null}
      {banner?.tokenAddress ? (
        <span className="banner__address">
          <span>{t('banner.address')}</span>{' '}
          <code className="mono">{banner.tokenAddress}</code>{' '}
          <button type="button" className="banner__copy" onClick={() => void copy(banner.tokenAddress)}>
            {copied ? t('banner.copied') : t('banner.copy')}
          </button>
        </span>
      ) : null}
      {banner?.note !== false ? <span className="banner__note">{t('banner.note')}</span> : null}
    </div>
  );
}
