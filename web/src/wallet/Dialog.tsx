// The pairing dialog frame shared by WizardConnect (BCH) and WalletConnect (EVM): title, close button with focus,
// Escape and a click outside to close, no blurred backdrop.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useText } from '../i18n';

export function Dialog(props: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useText();
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
            {props.title}
          </h2>
          <button ref={closeRef} type="button" className="connect__close" aria-label={t('wallet.close')} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

/** "Copy link" that says "Link copied" once the clipboard took it. */
export function CopyLink({ value }: { value: string }) {
  const { t } = useText();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button button--quiet"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => setCopied(false));
      }}
    >
      {copied ? t('wallet.copied') : t('wallet.copyLink')}
    </button>
  );
}
