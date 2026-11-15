// "Judging?" strip on the first screen: one quiet button that opens the landing tab with the judge amount from
// config, and the shortest real mainnet path folded under it. Shown only while the landing flow is open. On wide
// screens it sits in the left column under the picture, steps unfolded when the screen is tall; on phones it is a one-row
// strip ("Judging?" + Fill) between the picture and the card, so picture, strip and the card's primary button all stay on
// the first screen.
import type { LoadedConfig } from './config';
import { useText } from './i18n';

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
          <span className="judge__short">{t('judge.short')}</span>
          <span className="judge__long">{t('judge.title')}</span>
        </summary>
        <ol className="judge__steps">
          <li>{t('judge.step1')}</li>
          <li>{t('judge.step2', { amount: config.limits.judgeLandBch, symbol })}</li>
        </ol>
      </details>
      <button type="button" className="button button--quiet judge__fill" onClick={onFill}>
        {t('judge.fill')}
      </button>
    </aside>
  );
}
