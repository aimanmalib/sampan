// Shown once before the first crossing to or from another chain (both tabs): three short lines and "I understand",
// remembered in this browser's localStorage. Same dialog frame as the wallet dialog.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useText } from '../i18n';

const KEY = 'sampan.crossDisclosure';

/** True once "I understand" was pressed in this browser (here or in the review before signing). */
export const seen = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** Remembers the answer; in private mode the lines show again next time. */
export function remember(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Private mode: the dialog shows again next time.
  }
}

/** The three lines, shared with the review before signing (features.reviewModal), which shows them inside itself. */
export function DiscloseLines({ route }: { route: string }) {
  const { t } = useText();
  return (
    <ul className="disclose__list">
      <li>{t('disclose.route', { route })}</li>
      <li>{t('disclose.final')}</li>
      <li>{t('disclose.risks')}</li>
    </ul>
  );
}

function Dialog({ route, onAccept, onClose }: { route: string; onAccept: () => void; onClose: () => void }) {
  const { t } = useText();
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="connect" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="connect__box" role="dialog" aria-modal="true" aria-labelledby="disclose-title">
        <h2 id="disclose-title" className="connect__title">
          {t('disclose.title')}
        </h2>
        <DiscloseLines route={route} />
        <button ref={okRef} type="button" className="button button--primary" onClick={onAccept}>
          {t('disclose.ok')}
        </button>
        <button type="button" className="button button--quiet" onClick={onClose}>
          {t('disclose.cancel')}
        </button>
      </div>
    </div>
  );
}

/** `run(fn)` runs fn now if the disclosure was accepted before, otherwise after "I understand". */
export function useDisclosure(route: string): { run: (fn: () => void) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const run = (fn: () => void): void => (seen() ? fn() : setPending(() => fn));
  const dialog = pending ? (
    <Dialog
      route={route}
      onClose={() => setPending(null)}
      onAccept={() => {
        remember();
        const fn = pending;
        setPending(null);
        fn();
      }}
    />
  ) : null;
  return { run, dialog };
}
