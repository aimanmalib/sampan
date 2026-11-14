// /c/:id: where a crossing stands. Swaps have two steps (built, sent); later flows add theirs.
import { useCallback, useEffect, useState } from 'react';
import { ApiFailure } from '../../core/client/api';
import { api } from './api';
import type { LoadedConfig } from './config';
import { useText, type TextKey } from './i18n';

interface Crossing {
  id: string;
  kind: string;
  status: string;
  asset: string;
  txid: string | null;
  createdAt: number;
  updatedAt: number;
}

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'error' } | { state: 'ok'; crossing: Crossing };

const SWAP_STEPS = ['built', 'broadcast'] as const;
const STATUS_KEYS: Record<string, TextKey> = {
  built: 'crossing.status.built',
  stale: 'crossing.status.stale',
  broadcast: 'crossing.status.broadcast',
  failed: 'crossing.status.failed',
};

export function CrossingPage({ id, config }: { id: string; config: LoadedConfig | null }) {
  const { t } = useText();
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  const check = useCallback(() => {
    api
      .get<Crossing>(`/api/crossings/${id}`)
      .then((crossing) => setLoad({ state: 'ok', crossing }))
      .catch((e: unknown) => setLoad({ state: e instanceof ApiFailure && e.status === 404 ? 'missing' : 'error' }));
  }, [id]);
  useEffect(check, [check]);

  if (load.state !== 'ok') {
    return (
      <section className="crossing">
        <h1 className="crossing__title">{t('crossing.title')}</h1>
        <p className="card__note">{t(load.state === 'loading' ? 'crossing.loading' : load.state === 'missing' ? 'crossing.missing' : 'swap.err.offline')}</p>
        <a href="/">{t('crossing.back')}</a>
      </section>
    );
  }

  const c = load.crossing;
  const reached = c.status === 'broadcast' ? 2 : c.status === 'failed' ? 0 : 1;
  return (
    <section className="crossing">
      <h1 className="crossing__title">{t('crossing.title')}</h1>
      <p className="crossing__kind">{t(c.kind === 'swap' ? 'tabs.swap' : 'crossing.title')}</p>
      <ol className="timeline">
        {SWAP_STEPS.map((step, i) => {
          const done = i < reached;
          return (
            <li key={step} className={`timeline__step${done ? ' timeline__step--done' : ''}`}>
              <span className="timeline__mark" aria-hidden="true" />
              <span>
                {t(`crossing.step.${step}`)}
                <span className="visually-hidden">{done ? t('crossing.done') : t('crossing.pending')}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="crossing__status">{t(STATUS_KEYS[c.status] ?? 'crossing.status.built')}</p>
      {c.txid && config ? (
        <p className="crossing__tx">
          <span>{t('crossing.txid')} </span>
          <a className="mono" href={config.connect.explorerTxUrl.replace('{txid}', c.txid)} target="_blank" rel="noreferrer">
            {`${c.txid.slice(0, 10)}…${c.txid.slice(-8)}`}
          </a>
        </p>
      ) : null}
      <p className="crossing__actions">
        <button type="button" className="button button--quiet" onClick={check}>
          {t('crossing.check')}
        </button>
        <a href="/">{t('crossing.back')}</a>
      </p>
    </section>
  );
}
