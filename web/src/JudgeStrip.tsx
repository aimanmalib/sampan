// "Judging?" strip on the first screen: one quiet button that opens the landing tab with the judge amount from
// config, and the shortest real mainnet path folded under it. Shown only while the landing flow is open. On wide
// screens it sits in the left column under the picture, steps unfolded when the screen is tall; on phones it is a compact strip
// above the card so the card's primary button stays on the first screen. Under the steps, a link to the proof table
// on /how, so a judge reaches a mainnet transaction id without scrolling or waiting for /api/stats.
import type { LoadedConfig } from './config';
import { useText } from './i18n';
import { watchPath, watchRun } from './watch/WatchPage';

/** Steps start unfolded only on the two-column layout (styles.css breakpoint) when the screen is tall enough. */
const ROOMY = '(min-width: 56rem) and (min-height: 50rem)';

export function JudgeStrip({ config, onFill }: { config: LoadedConfig; onFill: () => void }) {
  const { t } = useText();
  const symbol = config.tokens[config.defaultToken]?.symbol ?? '';
  const wide = typeof window !== 'undefined' && window.matchMedia?.(ROOMY).matches;
  return (
    <aside className="judge" aria-labelledby="judge-title">
      <details className="judge__more" open={wide || undefined}>
        <summary className="judge__title" id="judge-title">
          {t('judge.title')}
        </summary>
        <ol className="judge__steps">
          <li>{t('judge.step1')}</li>
          <li>{t('judge.step2', { amount: config.limits.judgeLandBch, symbol })}</li>
        </ol>
        <p className="judge__proof">
          <a href="/how#proof">{t('judge.proof')}</a>
        </p>
        {/* The no-wallet replay, only while features.watchDemo is on and the measured run is in this build (KMN2). */}
        {watchRun(config) ? (
          <p className="judge__proof">
            <a href={watchPath('land')} data-watch-link>
              {t('judge.watch')}
            </a>
          </p>
        ) : null}
      </details>
      <button type="button" className="button button--quiet judge__fill" onClick={onFill}>
        {t('judge.fill')}
      </button>
    </aside>
  );
}
