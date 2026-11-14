// WizardConnect pairing: the library's QR code inside Sampan's own dialog (translated labels, 44 px targets,
// Escape to close, no blurred backdrop), plus "Copy link" for a wallet on the same phone.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlphanumericQRCode } from '@wizardconnect/react';
import { useText } from '../i18n';

const QR_SIZE = 240;

/** QR colours read from the CSS tokens, so the code follows styles.css. */
function qrColours(): { foreground: string; background: string } {
  const css = getComputedStyle(document.documentElement);
  return { foreground: css.getPropertyValue('--ink').trim(), background: css.getPropertyValue('--card').trim() };
}

export function ConnectDialog(props: { uri: string; qrUri: string; onClose: () => void }) {
  const { t } = useText();
  const colours = useMemo(() => qrColours(), []);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { onClose } = props;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="connect" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="connect__box" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <div className="connect__head">
          <h2 id="connect-title" className="connect__title">
            {t('wallet.dialogTitle')}
          </h2>
          <button ref={closeRef} type="button" className="connect__close" aria-label={t('wallet.close')} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="connect__text">{t('wallet.scan')}</p>
        <div className="connect__qr">
          <AlphanumericQRCode value={props.qrUri} size={QR_SIZE} foreground={colours.foreground} background={colours.background} />
        </div>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            void navigator.clipboard?.writeText(props.uri).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          {copied ? t('wallet.copied') : t('wallet.copyLink')}
        </button>
        <p className="connect__text">{t('wallet.pasteHint')}</p>
      </div>
    </div>
  );
}
