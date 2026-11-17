// The cost card above the button in Send out and Bring in: what is paid and received, the total cost in USD with its
// named parts, the share kept, the price impact, the time and how long the price holds. Numbers from core/cost.ts.
import { useEffect, useState } from 'react';
import { formatUsd as usd, type CostCard as Card } from '../../../core/cost';
import { useText } from '../i18n';
import './cost.css';

const pct = (bps: number): string => (bps / 100).toFixed(2);
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Seconds left until `expiresAt` (unix seconds); the clock ticks once a second while the card is shown. */
function useSecondsLeft(expiresAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, expiresAt - Math.floor(now / 1000));
}

export interface CostCardProps {
  card: Card;
  /** Text variables: route, chain, symbol, token, native. */
  vars: Record<string, string>;
  warnBps: number;
  /** Bring in: gas price unknown (extra) or counted with one approval. */
  gas?: 'extra' | 'approve' | 'deposit';
}

export function CostCard({ card, vars, warnBps, gas }: CostCardProps) {
  const { t } = useText();
  const left = useSecondsLeft(card.expiresAt);
  const time = card.minutes.to === undefined ? t('cost.time', { from: String(card.minutes.from) }) : t('cost.timeRange', { from: String(card.minutes.from), to: String(card.minutes.to) });
  return (
    <section className="cost" aria-labelledby="cost-title" data-testid="cost-card">
      <h3 className="cost__title" id="cost-title">
        {t('cost.title')}
      </h3>
      <p className="cost__pay">{t('cost.pay', { pay: usd(card.payUsd), receive: usd(card.receiveUsd) })}</p>
      <p className="cost__total">
        <strong data-testid="cost-total">{t('cost.total', { usd: usd(card.totalUsd) })}</strong>
        <span>{t('cost.keep', { pct: card.keepPct.toFixed(1) })}</span>
      </p>
      {card.leftoverUsd > 0n ? <p className="cost__line">{t('cost.leftover', { usd: usd(card.leftoverUsd) })}</p> : null}
      <p className="cost__line">
        <span>{t('cost.impact', { pct: pct(card.impactBps) })}</span>
        <span>{time}</span>
      </p>
      {card.warn.impact ? <p className="swap__error">{t('cost.impactHigh', { pct: pct(warnBps) })}</p> : null}
      {card.warn.cost ? <p className="swap__error">{t('cost.costHigh', { pct: pct(warnBps) })}</p> : null}
      <p className="cost__line cost__clock" data-testid="cost-clock">
        {left > 0 ? t('cost.expires', { time: clock(left) }) : t('cost.expired')}
      </p>
      {gas === 'extra' ? <p className="cost__line">{t('cost.gasExtra', vars)}</p> : null}
      <details className="cost__parts">
        <summary>{t('cost.details')}</summary>
        <ul>
          {card.parts.map((p) => (
            <li key={p.key} data-part={p.key}>
              <span>{t(`cost.part.${p.key}`, vars)}</span>
              <span className="mono">{usd(p.usd)}</span>
            </li>
          ))}
        </ul>
        {gas === 'approve' ? <p>{t('cost.gasApprove', vars)}</p> : null}
        <p>{t('cost.basis', vars)}</p>
      </details>
    </section>
  );
}
