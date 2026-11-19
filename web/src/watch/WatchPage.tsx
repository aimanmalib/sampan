// "Watch it run" (/watch?dir=land): a replay of one landing the measurements record (site.watch.land in
// docs/MEASURED.md, read when the page was built). No wallet is connected and nothing is built, signed or sent: the
// wallet on the page holds play money. Each step links the real transaction in an explorer, and the clock says how
// the replay's pace compares with the measured time. The steps move with CSS (transform and opacity only); the end of
// the last step's animation marks the replay done. With reduced motion every step shows at once.
// Without features.watchDemo, or when the run is not in the measurements, the path is the friendly not-found page.
import { useState } from 'react';
import proof from 'virtual:sampan-proof';
import { landRun } from '../../../core/proof';
import { replayPace, watchDir } from '../../../core/watch';
import type { LoadedConfig } from '../config';
import { runText } from '../how/txLinks';
import { useText } from '../i18n';
import './watch.css';

const STEPS = ['watch.step1', 'watch.step2', 'watch.step3'] as const;
const STOPS = ['watch.wallet', 'watch.address', 'watch.owner'] as const;
const REDUCED = '(prefers-reduced-motion: reduce)';

export const watchPath = (dir: 'land'): string => `/watch?dir=${dir}`;

/** The measured run /watch would replay, or null when the page should not exist (flag off, no run, unknown dir). */
export function watchRun(config: LoadedConfig | null, search = '?dir=land') {
  if (!config?.features.watchDemo || watchDir(search) !== 'land') return null;
  return landRun(proof, config.site.watch.land);
}

export function NotFound() {
  const { t } = useText();
  return (
    <section className="crossing" data-not-found>
      <h1 className="crossing__title">{t('error.page.notFound')}</h1>
      <p className="crossing__status">{t('error.page.notFoundBody')}</p>
      <p className="crossing__actions">
        <a href="/">{t('error.page.home')}</a>
      </p>
    </section>
  );
}

export function WatchPage({ config }: { config: LoadedConfig | null }) {
  const { t } = useText();
  const [round, setRound] = useState(0);
  // With reduced motion nothing animates, so the replay is done from the start.
  const [reduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(REDUCED).matches === true);
  const [done, setDone] = useState(reduced);
  if (!config) return <p className="card__note">{t('crossing.loading')}</p>;
  const run = watchRun(config, location.search);
  if (!run || run.seconds === null) return <NotFound />;
  const symbol = config.tokens[config.defaultToken]?.symbol ?? '';
  const { href, time } = runText(config, t);
  const tx = run.txids.find((x) => x.chain === 'bch')!;
  const stepMs = config.site.watch.stepMs;
  const pace = replayPace(run.seconds, STEPS.length, stepMs);
  return (
    <section
      className="crossing watch"
      data-watch="land"
      data-motion={reduced ? 'static' : 'replay'}
      data-done={done ? 'true' : 'false'}
      // The step length comes from config; set through the style object, not an inline style attribute (CSP).
      ref={(el) => el?.style.setProperty('--watch-step', `${stepMs}ms`)}
    >
      <h1 className="crossing__title">{t('watch.title')}</h1>
      <p className="crossing__status">{t('watch.lead')}</p>
      <div className="watch__stage" key={round} aria-hidden="true">
        <div className="watch__track">
          <span className="watch__coin" />
        </div>
        <div className="watch__stops">
          {STOPS.map((k, i) => (
            <span key={k} className="watch__stop">
              {t(k)}
              {i === 0 ? <em className="watch__play">{t('watch.play')}</em> : null}
            </span>
          ))}
        </div>
      </div>
      <ol className="watch__steps" key={`s${round}`}>
        {STEPS.map((k, i) => (
          <li
            key={k}
            className="watch__step"
            data-step={i + 1}
            onAnimationEnd={i === STEPS.length - 1 ? () => setDone(true) : undefined}
          >
            <p>{t(k, { symbol })}</p>
            <a className="watch__tx" href={href(tx)} target="_blank" rel="noreferrer" data-txid={tx.id}>
              {t('watch.tx')}
            </a>
          </li>
        ))}
      </ol>
      <p className="watch__clock" data-pace={pace.kind}>
        {t(`watch.clock.${pace.kind}`, { n: String(pace.factor), real: time(run.seconds) })}
      </p>
      <dl className="done__facts">
        <div>
          <dt>{t('watch.run')}</dt>
          <dd lang="en">{run.amount}</dd>
        </div>
        <div>
          <dt>{t('done.when')}</dt>
          <dd className="mono">{run.utc.replace('T', ' ').replace(/Z$/, '')}</dd>
        </div>
      </dl>
      <p className="crossing__actions">
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            setDone(reduced);
            setRound((n) => n + 1);
          }}
        >
          {t('watch.again')}
        </button>
        <a href="/">{t('watch.try')}</a>
        <a href="/how#proof">{t('done.more')}</a>
      </p>
    </section>
  );
}
