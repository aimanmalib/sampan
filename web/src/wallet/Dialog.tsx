// The dialog frame shared by WizardConnect (BCH), WalletConnect (EVM) and the review before signing: title, close button
// with focus, Tab kept inside the box, Escape and a click outside to close, no blurred backdrop. An optional icon (hidden
// from screen readers) leads the title. `liveQuote` lets the page's price refresh go on under the dialog (the review
// shows the change and asks again, ADR 0092); every other dialog pauses it (quote/refresh.ts).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useText } from '../i18n';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab from the last control goes to the first, Shift+Tab from the first to the last; focus never leaves the box. */
export function trapTab(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>, box: HTMLElement | null): void {
  if (e.key !== 'Tab' || !box) return;
  const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  const outside = !box.contains(active);
  if (e.shiftKey && (active === first || outside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || outside)) {
    e.preventDefault();
    first.focus();
  }
}

export function Dialog(props: { title: string; icon?: ReactNode; onClose: () => void; children: ReactNode; className?: string; liveQuote?: boolean }) {
  const { t } = useText();
  const closeRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const { onClose } = props;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      trapTab(e, boxRef.current);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="connect" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={boxRef}
        className={props.className ? `connect__box ${props.className}` : 'connect__box'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        {...(props.liveQuote ? { 'data-live-quote': '' } : {})}
      >
        <div className="connect__head">
          <h2 id="connect-title" className="connect__title">
            {props.icon}
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
