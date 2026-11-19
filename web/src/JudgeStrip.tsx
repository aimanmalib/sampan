// "Judging?" box on the front page: one quiet button that opens the landing tab with the judge amount from config,
// and the shortest real mainnet path with links to the no-wallet replay and the proof table on /how, so a judge
// reaches a mainnet transaction id without scrolling or waiting for /api/stats.
// With judge.openOnPhone on, the steps start unfolded on every screen (KMN4, docs/decisions/0069). On wide screens
// they unfold inside the box in the left column, Fill beside the title. On phones the strip above the card keeps only
// the title and Fill, and the unfolded steps sit right under the card (JudgeBox), so the card's primary button stays on
// the first screen. With it off, the steps stay folded except on a tall two-column screen, as before.
import type { LoadedConfig } from './config';
import { useText } from './i18n';
import { watchPath, watchRun } from './watch/WatchPage';

/** Two-column layout (styles.css breakpoint) with a screen tall enough for the steps beside the card. */
const ROOMY = '(min-width: 56rem) and (min-height: 50rem)';
const WIDE = '(min-width: 56rem)';
const BOX_ID = 'judge-box';

const matches = (query: string): boolean => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches);

/** True when the unfolded steps go under the card: a phone-width screen with judge.openOnPhone on. */
export function judgeBelow(config: LoadedConfig): boolean {
  return config.judge.openOnPhone && !matches(WIDE);
}

function JudgeSteps({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  const symbol = config.tokens[config.defaultToken]?.symbol ?? '';
  return (
    <>
      <ol className="judge__steps">
        <li>{t('judge.step1')}</li>
        <li>{t('judge.step2', { amount: config.limits.judgeLandBch, symbol })}</li>
      </ol>
      {/* The no-wallet replay, only while features.watchDemo is on and the measured run is in this build (KMN2). */}
      {watchRun(config) ? (
        <p className="judge__proof">
          <a href={watchPath('land')} data-watch-link>
            {t('judge.watch')}
          </a>
        </p>
      ) : null}
      <p className="judge__proof">
        <a href="/how#proof">{t('judge.proof')}</a>
      </p>
    </>
  );
}

export function JudgeStrip({ config, onFill }: { config: LoadedConfig; onFill: () => void }) {
  const { t } = useText();
  const fill = (
    <button type="button" className="button button--quiet judge__fill" onClick={onFill}>
      {t('judge.fill')}
    </button>
  );
  if (judgeBelow(config)) {
    return (
      <aside className="judge" aria-labelledby="judge-title">
        <a className="judge__title judge__jump" id="judge-title" href={`#${BOX_ID}`}>
          {t('judge.title')}
        </a>
        {fill}
      </aside>
    );
  }
  const open = matches(WIDE) && (config.judge.openOnPhone || matches(ROOMY));
  return (
    <aside className="judge" aria-labelledby="judge-title">
      <details className="judge__more" open={open || undefined}>
        <summary className="judge__title" id="judge-title">
          {t('judge.title')}
        </summary>
        <JudgeSteps config={config} />
      </details>
      {fill}
    </aside>
  );
}

/** The unfolded steps under the card on a phone (rendered only when judgeBelow is true). */
export function JudgeBox({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  return (
    <details className="judgebox" id={BOX_ID} open>
      <summary className="judge__boxtitle">{t('judge.box')}</summary>
      <JudgeSteps config={config} />
    </details>
  );
}
