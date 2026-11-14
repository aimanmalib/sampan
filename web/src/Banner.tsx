import { useState } from 'react';
import { shortAddress } from './address';
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
          <span className="banner__label">{t('banner.address')}</span>
          <button
            type="button"
            className="banner__copy"
            title={banner.tokenAddress}
            onClick={() => void copy(banner.tokenAddress)}
          >
            <code className="mono">{shortAddress(banner.tokenAddress)}</code>
            <span className="banner__copy-word" aria-live="polite">
              {copied ? t('banner.copied') : t('banner.copy')}
            </span>
          </button>
        </span>
      ) : null}
      {banner?.note !== false ? <span className="banner__note">{t('banner.note')}</span> : null}
    </div>
  );
}
