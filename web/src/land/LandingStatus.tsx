// Status of one landing on /c/:id: a timeline (icon and words, not colour alone), a boat that crosses as the steps
// complete (transform only, still under prefers-reduced-motion), the transactions with explorer links, and the
// recovery card read from the link's fragment. The card never goes to the server.
import { cardFromFragment, type LandingCard } from '../../../core/landing-card';
import type { LoadedConfig } from '../config';
import { useText } from '../i18n';

export interface LandingView {
  status: string;
  txid: string | null;
  landing: { address: string | null; paymentTxid: string | null; watching: boolean };
}

const STEPS = ['waiting', 'seen', 'converted', 'arrived'] as const;
const RETURNED_STEPS = ['waiting', 'seen', 'returned'] as const;

function reached(status: string): number {
  if (status === 'converted') return 4;
  if (status === 'returned') return 3;
  if (status === 'seen') return 2;
  return 1;
}

const short = (txid: string): string => `${txid.slice(0, 10)}…${txid.slice(-8)}`;

function TxLine({ label, txid, config }: { label: string; txid: string; config: LoadedConfig | null }) {
  return (
    <p className="crossing__tx">
      <span>{label} </span>
      {config ? (
        <a className="mono" href={config.connect.explorerTxUrl.replace('{txid}', txid)} target="_blank" rel="noreferrer">
          {short(txid)}
        </a>
      ) : (
        <span className="mono">{short(txid)}</span>
      )}
    </p>
  );
}

function Card({ fragment }: { fragment: string | null }) {
  const { t } = useText();
  if (!fragment) return <p className="card__note">{t('crossing.card.missing')}</p>;
  const read = cardFromFragment(fragment);
  if (typeof read === 'string') return <p className="swap__error">{t('crossing.card.bad')}</p>;
  const json = JSON.stringify(read.card, null, 2);
  const download = (card: LandingCard): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `sampan-landing-${card.address.slice(-8)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <details className="recovery">
      <summary>{t('crossing.card.title')}</summary>
      <p className="card__note">{t('crossing.card.text')}</p>
      <pre className="recovery__json mono">{json}</pre>
      <button type="button" className="button button--quiet" onClick={() => download(read.card)}>
        {t('crossing.card.download')}
      </button>
    </details>
  );
}

/** Boat on the river; its position class follows the step reached. Decorative: the timeline carries the meaning. */
function Ferry({ step, of }: { step: number; of: number }) {
  return (
    <div className="ferry" aria-hidden="true">
      <svg className="ferry__river" viewBox="0 0 300 40" preserveAspectRatio="none">
        <path d="M0 30 Q 37 24 75 30 T 150 30 T 225 30 T 300 30" />
      </svg>
      <div className={`ferry__lane ferry__lane--${step}-of-${of}`}>
        <svg className="ferry__boat" viewBox="0 0 48 28">
          <path className="ferry__hull" d="M2 16 h44 l-7 9 h-30 z" />
          <path className="ferry__roof" d="M14 16 q10 -12 20 0" />
          <circle className="ferry__coin" cx="24" cy="12" r="3.5" />
        </svg>
      </div>
    </div>
  );
}

export function LandingStatus({ c, config, fragment, onCheck }: { c: LandingView; config: LoadedConfig | null; fragment: string | null; onCheck: () => void }) {
  const { t } = useText();
  const symbol = config?.tokens[config.defaultToken]?.symbol ?? '';
  const steps = c.status === 'returned' ? RETURNED_STEPS : STEPS;
  const done = reached(c.status);
  const statusKey =
    c.status === 'converted' || c.status === 'returned' || c.status === 'seen' ? (`crossing.land.status.${c.status}` as const) : 'crossing.land.status.open';
  return (
    <>
      <Ferry step={Math.min(done, steps.length)} of={steps.length} />
      <ol className="timeline">
        {steps.map((step, i) => {
          const isDone = i < done;
          return (
            <li key={step} className={`timeline__step${isDone ? ' timeline__step--done' : ''}`}>
              <span className="timeline__mark" aria-hidden="true" />
              <span>
                {t(`crossing.land.step.${step}`, { symbol })}
                <span className="visually-hidden">{isDone ? t('crossing.done') : t('crossing.pending')}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="crossing__status" aria-live="polite">
        {t(statusKey, { symbol })}
        {c.status === 'returned' ? (
          <>
            {' '}
            <a href="/">{t('crossing.land.swapLink')}</a>
          </>
        ) : null}
      </p>
      {c.landing.address ? (
        <p className="crossing__tx">
          <span>{t('crossing.land.address')} </span>
          <span className="mono crossing__address">{c.landing.address}</span>
        </p>
      ) : null}
      {c.landing.paymentTxid ? <TxLine label={t('crossing.land.payment')} txid={c.landing.paymentTxid} config={config} /> : null}
      {c.txid ? <TxLine label={t(c.status === 'returned' ? 'crossing.land.return' : 'crossing.land.finish')} txid={c.txid} config={config} /> : null}
      <Card fragment={fragment} />
      <p className="crossing__actions">
        <button type="button" className="button button--quiet" onClick={onCheck}>
          {t('crossing.check')}
        </button>
        <a href="/">{t('crossing.back')}</a>
      </p>
    </>
  );
}
