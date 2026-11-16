// Status of one landing on /c/:id: a timeline (icon and words, not colour alone), the ferry (both read ferryStep), the transactions with explorer links, and the
// recovery card read from the link's fragment. The card never goes to the server.
import { cardFromFragment, type LandingCard } from '../../../core/landing-card';
import type { LoadedConfig } from '../config';
import { Ferry, useBanks } from '../ferry/Ferry';
import { ferryStep } from '../ferry/step';
import { useText, type TextKey } from '../i18n';

export interface LandingView {
  status: string;
  txid: string | null;
  landing: { address: string | null; paymentTxid: string | null; watching: boolean };
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

export function LandingStatus({ c, config, fragment, onCheck }: { c: LandingView; config: LoadedConfig | null; fragment: string | null; onCheck: () => void }) {
  const { t } = useText();
  const symbol = config?.tokens[config.defaultToken]?.symbol ?? '';
  const at = ferryStep('land', { status: c.status, txid: c.txid });
  const banks = useBanks('land', { symbol });
  const statusKey =
    c.status === 'converted' || c.status === 'returned' || c.status === 'seen' ? (`crossing.land.status.${c.status}` as const) : 'crossing.land.status.open';
  return (
    <>
      <Ferry kind="land" at={at} banks={banks} motion={config?.ui.ferryMotion ?? false} />
      <ol className="timeline">
        {at.steps.map((step, i) => {
          const isDone = i < at.done;
          return (
            <li key={step} className={`timeline__step${isDone ? ' timeline__step--done' : ''}`}>
              <span className="timeline__mark" aria-hidden="true" />
              <span>
                {t(`crossing.land.step.${step}` as TextKey, { symbol })}
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
