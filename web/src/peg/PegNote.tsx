// The peg warning on the swap, Send out, Bring in and landing panels: shown only while PUSD sits peg.warnBps or more
// from one dollar (the server says which level). Nothing at all while the peg is ok or unknown.
import { useText } from '../i18n';
import { gapText, useDepth } from './usePeg';

export function PegNote() {
  const { t } = useText();
  const d = useDepth();
  if (typeof d === 'string' || d.pegBps === null || (d.peg !== 'warn' && d.peg !== 'refuse')) return null;
  return (
    <p className="swap__error" role="status" data-peg={d.peg}>
      {t('peg.warn', { symbol: d.symbol, gap: gapText(d.pegBps) })}
    </p>
  );
}
