// /c/:id: where a crossing stands. Swaps have two steps (built, sent); a landing has its own view and, while it
// waits, asks the server to check again every `landing.pagePollSeconds`.
import { useCallback, useEffect, useState } from 'react';
import { ApiFailure } from '../../core/client/api';
import { api } from './api';
import type { LoadedConfig } from './config';
import { Ferry, useBanks } from './ferry/Ferry';
import { ferryStep } from './ferry/step';
import { useText, type TextKey } from './i18n';
import { LandingStatus, type LandingView } from './land/LandingStatus';
import { OutStatus, outIsFinal, type OutView } from './out/OutStatus';

interface Crossing {
  id: string;
  kind: string;
  status: string;
  asset: string;
  txid: string | null;
  createdAt: number;
  updatedAt: number;
  landing?: LandingView['landing'];
  route?: OutView['route'];
  out?: OutView['out'];
  landingId?: string | null;
}

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'error' } | { state: 'ok'; crossing: Crossing };

const STATUS_KEYS: Record<string, TextKey> = {
  built: 'crossing.status.built',
  stale: 'crossing.status.stale',
  broadcast: 'crossing.status.broadcast',
  failed: 'crossing.status.failed',
};

const asOut = (c: Crossing): OutView => ({ status: c.status, route: c.route ?? null, asset: c.asset, txid: c.txid, out: c.out ?? null });

export function CrossingPage({ id, config }: { id: string; config: LoadedConfig | null }) {
  const { t } = useText();
  const swapBanks = useBanks('swap', {});
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  const fragment = /(?:^#|&)card=([A-Za-z0-9_-]+)/.exec(location.hash)?.[1] ?? null;
  const isLanding = load.state === 'ok' && load.crossing.kind === 'land';

  const check = useCallback(
    (kick = false) => {
      const req = kick ? api.post<Crossing>(`/api/crossings/${id}/kick`, {}) : api.get<Crossing>(`/api/crossings/${id}`);
      req
        .then((crossing) => setLoad({ state: 'ok', crossing }))
        .catch((e: unknown) => setLoad((prev) => (prev.state === 'ok' ? prev : { state: e instanceof ApiFailure && e.status === 404 ? 'missing' : 'error' })));
    },
    [id],
  );
  useEffect(() => check(false), [check]);

  // A landing still waiting: ask the server to look again now and then (it also watches by itself).
  const landWaiting = load.state === 'ok' && load.crossing.kind === 'land' && ['open', 'seen'].includes(load.crossing.status) && load.crossing.landing?.watching;
  // A crossing out that was sent: the server asks the route each time the page asks.
  const outWaiting = load.state === 'ok' && (load.crossing.kind === 'out' || load.crossing.kind === 'in') && !!load.crossing.txid && !outIsFinal(asOut(load.crossing));
  const waiting = landWaiting || outWaiting;
  const pollMs = (config?.landing.pagePollSeconds ?? 10) * 1000;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => check(!outWaiting), pollMs);
    return () => clearInterval(timer);
  }, [waiting, outWaiting, pollMs, check]);

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
  if (isLanding && c.landing) {
    return (
      <section className="crossing">
        <h1 className="crossing__title">{t('crossing.title')}</h1>
        <p className="crossing__kind">{t('crossing.kind.land')}</p>
        <LandingStatus c={{ status: c.status, txid: c.txid, landing: c.landing }} config={config} fragment={fragment} onCheck={() => check(true)} />
      </section>
    );
  }
  if (c.kind === 'out' || c.kind === 'in') {
    return (
      <section className="crossing">
        <h1 className="crossing__title">{t('crossing.title')}</h1>
        <p className="crossing__kind">{t(c.kind === 'in' ? 'crossing.kind.in' : 'crossing.kind.out')}</p>
        <OutStatus c={asOut(c)} config={config} direction={c.kind} />
        {c.landingId ? (
          <p className="crossing__tx">
            <a href={`/c/${c.landingId}`}>{t('in.landingStatus')}</a>
          </p>
        ) : null}
        <p className="crossing__actions">
          <button type="button" className="button button--quiet" onClick={() => check(false)}>
            {t('crossing.check')}
          </button>
          <a href="/">{t('crossing.back')}</a>
        </p>
      </section>
    );
  }
  const at = ferryStep('swap', c);
  return (
    <section className="crossing">
      <h1 className="crossing__title">{t('crossing.title')}</h1>
      <p className="crossing__kind">{t(c.kind === 'swap' ? 'crossing.kind.swap' : 'crossing.title')}</p>
      {config?.ui.ferryMotion ? <Ferry kind="swap" at={at} banks={swapBanks} motion /> : null}
      <ol className="timeline">
        {at.steps.map((step, i) => {
          const done = i < at.done;
          return (
            <li key={step} className={`timeline__step${done ? ' timeline__step--done' : ''}`}>
              <span className="timeline__mark" aria-hidden="true" />
              <span>
                {t(`crossing.step.${step}` as TextKey)}
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
        <button type="button" className="button button--quiet" onClick={() => check(false)}>
          {t('crossing.check')}
        </button>
        <a href="/">{t('crossing.back')}</a>
      </p>
    </section>
  );
}
