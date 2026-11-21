// The review before signing (features.reviewModal, K5P8): one dialog in Swap, Send out and Bring in that lists what is
// paid, received, kept and spent, the route, the time and the address. Before a first crossing it also carries the three
// disclosure lines (no second dialog). The price goes on refreshing under it: when the numbers change the dialog says
// "Price updated" and the next press only accepts the new numbers; the wallet is asked to sign only after a press on
// unchanged numbers. Escape, Cancel, the close button or a click outside close it without signing.
import { useState, type ReactNode } from 'react';
import { useText, type TextKey } from '../i18n';
import { Dialog } from '../wallet/Dialog';
import { DiscloseLines, remember, seen, useDisclosure } from '../cross/disclosure';
import { fingerprint, type ReviewRow } from './rows';
import './review.css';

export interface ReviewOptions {
  /** config.features.reviewModal; off = the panel's previous behaviour (sign at once, after the disclosure if any). */
  on: boolean;
  /** Route name for the first-crossing disclosure; null for Swap on BCH, which crosses no chain. */
  disclose: string | null;
  /** The numbers as they are now; null while no usable price is shown. */
  rows: ReviewRow[] | null;
  /** Asks the wallet to sign with the numbers shown now. */
  onConfirm: () => void;
}

type Open = { snap: string; rows: ReviewRow[]; firstCross: boolean } | null;

export function useReview(o: ReviewOptions): { open: () => void; dialog: ReactNode } {
  const { t } = useText();
  const gate = useDisclosure(o.disclose ?? '');
  const [shown, setShown] = useState<Open>(null);

  if (!o.on) {
    return { open: () => (o.disclose === null ? o.onConfirm() : gate.run(o.onConfirm)), dialog: gate.dialog };
  }

  const open = (): void => {
    if (!o.rows) return;
    setShown({ snap: fingerprint(o.rows), rows: o.rows, firstCross: o.disclose !== null && !seen() });
  };
  if (!shown) return { open, dialog: null };

  const rows = o.rows ?? shown.rows;
  const changed = o.rows !== null && fingerprint(o.rows) !== shown.snap;
  const close = (): void => setShown(null);
  const press = (): void => {
    if (!o.rows) return;
    if (changed) return setShown({ ...shown, snap: fingerprint(o.rows), rows: o.rows });
    if (shown.firstCross) remember();
    setShown(null);
    o.onConfirm();
  };

  const dialog = (
    <Dialog title={t('review.title')} onClose={close} className="review" liveQuote>
      <dl className="review__rows" data-testid="review-rows">
        {rows.map((r) => (
          <div key={r.key} className="review__row" data-row={r.key}>
            <dt>{t(`review.${r.key}` as TextKey)}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      {shown.firstCross && o.disclose !== null ? <DiscloseLines route={o.disclose} /> : null}
      {changed ? (
        <p className="review__updated" role="status" data-testid="review-updated">
          {t('review.updated')}
        </p>
      ) : null}
      <button type="button" className="button button--primary review__go" disabled={o.rows === null} onClick={press}>
        {changed ? t('review.accept') : t('review.confirm')}
      </button>
      <button type="button" className="button button--quiet" onClick={close}>
        {t('review.cancel')}
      </button>
    </Dialog>
  );
  return { open, dialog };
}
