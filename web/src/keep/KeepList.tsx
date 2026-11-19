// "Compare networks" (ADR 0074): the rows core/keep.ts builds, each a button that picks its network, like the
// Network picker above. A paused row is greyed with the route that paused it and cannot be pressed; a row without a
// price says so and leaves the others as they are.
import { useId } from 'react';
import type { NetworkRow } from '../../../core/cross-choices';
import { cardText, costMinutes } from '../../../core/cost';
import type { KeepRow } from '../../../core/keep';
import { ChipIcon } from '../chips/Chip';
import type { LoadedConfig } from '../config';
import { usePausedText } from '../cross/NetworkPicker';
import { useText } from '../i18n';
import './keep.css';

export function KeepList({
  config,
  networks,
  rows,
  picked,
  onPick,
  disabled,
  receiveSymbol,
  gasExtra,
}: {
  config: LoadedConfig;
  networks: readonly NetworkRow[];
  rows: readonly KeepRow[];
  picked: string | undefined;
  onPick: (asset: string) => void;
  disabled: boolean;
  receiveSymbol: string;
  gasExtra: boolean;
}) {
  const { t } = useText();
  const paused = usePausedText();
  const title = useId();
  return (
    <section className="keep" aria-labelledby={title} data-testid="keep">
      <p className="keep__title" id={title}>
        {t('keep.title')}
      </p>
      <p className="keep__intro">{t('keep.intro')}</p>
      <ul className="keep__list">
        {rows.map((row) => {
          const n = networks.find((x) => x.asset === row.asset)!;
          const chosen = row.open && row.asset === picked;
          const q = row.quote;
          return (
            <li key={row.asset} className="keep__item">
              <button
                type="button"
                className={`keep__row${row.open ? '' : ' keep__row--paused'}${chosen ? ' keep__row--chosen' : ''}`}
                data-asset={row.asset}
                data-status={row.open ? 'open' : 'paused'}
                data-best={row.best ? 'true' : undefined}
                aria-pressed={chosen}
                disabled={disabled || !row.open}
                onClick={() => onPick(row.asset)}
              >
                <span className="keep__head">
                  <span className="network__icons">
                    <ChipIcon config={config} name={n.symbol} />
                    <ChipIcon config={config} name={n.chain.key} />
                  </span>
                  <span className="keep__name">{t('out.toAsset', { symbol: n.symbol, chain: n.chain.name })}</span>
                  {row.best ? <span className="keep__best">{t('keep.best')}</span> : null}
                  {chosen ? <span className="keep__chosen">{t('keep.chosen')}</span> : null}
                </span>
                {!row.open ? (
                  <span className="keep__fact">{paused(n)}</span>
                ) : q.status === 'pending' ? (
                  <span className="keep__fact">{t('keep.pending')}</span>
                ) : q.status === 'error' ? (
                  <span className="keep__fact">{t('keep.error')}</span>
                ) : (
                  <>
                    <span className="keep__amount">{t('keep.row', { amount: q.receive, symbol: receiveSymbol, pct: q.card.keepPct.toFixed(1) })}</span>
                    <span className="keep__fact">
                      {t('cost.total', { usd: cardText(q.card).total })}
                      {' · '}
                      {minutesText(t, q.card.minutes)}
                    </span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {gasExtra ? <p className="keep__fact">{t('keep.gasExtra')}</p> : null}
    </section>
  );
}

type T = ReturnType<typeof useText>['t'];
const minutesText = (t: T, m: ReturnType<typeof costMinutes>): string =>
  m.to === undefined ? t('cost.time', { from: String(m.from) }) : t('cost.timeRange', { from: String(m.from), to: String(m.to) });
