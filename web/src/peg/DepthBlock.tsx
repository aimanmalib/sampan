// "Liquidity and peg right now" on /how: what GET /api/depth read, when (UTC), and links to the two sources it read
// (the first configured indexer and THORNode's BCH pool). A failed read says so and shows no numbers.
import type { LoadedConfig } from '../config';
import { useText } from '../i18n';
import { gapText, useDepth } from './usePeg';
import './peg.css';

const scaled = (value: string, decimals: number): number => Number(value) / 10 ** decimals;

export function DepthBlock({ config }: { config: LoadedConfig }) {
  const { t, lang } = useText();
  const d = useDepth();
  const num = (n: number, digits = 2): string => n.toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const pct = (bps: number): string => gapText(bps);
  return (
    <section className="depth" id="depth" aria-labelledby="depth-title" aria-busy={d === 'loading'}>
      <h2 id="depth-title">{t('depth.title')}</h2>
      {d === 'loading' ? (
        <p>{t('depth.loading')}</p>
      ) : d === 'down' ? (
        <p className="swap__error" role="status">
          {t('depth.down')}
        </p>
      ) : (
        <>
          <p>{t('depth.lead', { time: new Date(d.read).toISOString().slice(0, 16).replace('T', ' ') })}</p>
          <dl className="depth__list">
            <dt>{t('depth.pools')}</dt>
            <dd data-depth="pools">{d.pools}</dd>
            <dt>{t('depth.bch')}</dt>
            <dd>{num(scaled(d.bch, 8))} BCH</dd>
            <dt>{t('depth.token', { symbol: d.symbol })}</dt>
            <dd>
              {num(scaled(d.token, d.decimals))} {d.symbol}
            </dd>
            <dt>{t('depth.mid')}</dt>
            <dd>
              {num(scaled(d.midPriceE8, 8))} {d.symbol}
            </dd>
            <dt>{t('depth.onePercent')}</dt>
            <dd>{num(scaled(d.onePercentBch, 8))} BCH</dd>
            <dt>{t('depth.bchUsd')}</dt>
            <dd>{d.bchUsdE8 === null ? t('depth.unknown') : `USD ${num(scaled(d.bchUsdE8, 8))}`}</dd>
            <dt>{t('depth.peg', { symbol: d.symbol })}</dt>
            <dd data-peg={d.peg}>{d.pegBps === null ? t('depth.unknown') : `${d.pegBps < 0 ? '-' : '+'}${pct(d.pegBps)}`}</dd>
          </dl>
          <p>{t('depth.rule', { warn: pct(config.peg.warnBps), refuse: pct(config.peg.refuseBps) })}</p>
          <p className="depth__sources">
            <a href={d.sources.pools} target="_blank" rel="noreferrer">
              {t('depth.source.pools')}
            </a>
            {d.sources.price ? (
              <a href={d.sources.price} target="_blank" rel="noreferrer">
                {t('depth.source.price')}
              </a>
            ) : null}
          </p>
        </>
      )}
    </section>
  );
}
