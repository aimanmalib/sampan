// "My activity" (/activity, ADR 0076): the crossings this server made for the wallets connected on this page, each
// linked to its status page, and a field that finds where a pasted transaction id leads. The page sends only its own
// wallets' addresses (POST /api/activity); a txid goes to GET /api/lookup/:txid. Nothing is signed here.
import { useEffect, useState, type FormEvent } from 'react';
import { activityAddresses, activityState, bareTxid, type ActivityRow } from '../../../core/activity';
import { ApiFailure } from '../../../core/client/api';
import { symbolList } from '../../../core/flows';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import { EvmWallets } from '../evm/EvmWallets';
import { useEvm } from '../evm/store';
import { useText, type TextKey } from '../i18n';
import { ConnectDialog } from '../wallet/ConnectDialog';
import type { Wallet } from '../wallet/useWallet';
import './activity.css';

type Lookup = { at: 'idle' | 'busy' } | { at: 'found'; url: string } | { at: 'error'; key: TextKey };
type Answer = { key: string } & ({ at: 'ok'; rows: ActivityRow[] } | { at: 'error' });
type List = { at: 'idle' | 'busy' } | Answer;

const LOOKUP_ERRORS: Record<string, TextKey> = { bad_txid: 'activity.find.bad', not_found: 'activity.find.notFound', rate_limited: 'activity.busy' };

function FindTx() {
  const { t } = useText();
  const [text, setText] = useState('');
  const [state, setState] = useState<Lookup>({ at: 'idle' });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const bare = bareTxid(text);
    if (!bare) return setState({ at: 'error', key: 'activity.find.bad' });
    setState({ at: 'busy' });
    try {
      const { url } = await api.get<{ url: string }>(`/api/lookup/${bare}`);
      if (url.startsWith('/')) return location.assign(url);
      setState({ at: 'found', url });
    } catch (err) {
      setState({ at: 'error', key: (err instanceof ApiFailure && LOOKUP_ERRORS[err.code]) || 'activity.find.error' });
    }
  };
  return (
    <form className="activity__find" data-find={state.at} onSubmit={(e) => void submit(e)}>
      <h2 className="activity__heading">{t('activity.find.title')}</h2>
      <label className="field">
        <span className="field__label">{t('activity.find.label')}</span>
        <span className="field__row">
          <input
            className="field__input field__input--address mono"
            name="txid"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </span>
      </label>
      <button type="submit" className="button button--primary" disabled={state.at === 'busy' || text.trim() === ''}>
        {t(state.at === 'busy' ? 'activity.find.busy' : 'activity.find.go')}
      </button>
      {state.at === 'found' ? (
        <p className="activity__note">
          {t('activity.find.thorchain')} <a href={state.url}>{t('activity.find.open')}</a>
        </p>
      ) : null}
      {state.at === 'error' ? (
        <p className="swap__error" role="alert">
          {t(state.key)}
        </p>
      ) : null}
    </form>
  );
}

function Rows({ rows, lang }: { rows: ActivityRow[]; lang: string }) {
  const { t } = useText();
  if (rows.length === 0) return <p className="activity__note" data-empty>{t('activity.list.empty')}</p>;
  const when = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <ul className="activity__list">
      {rows.map((r) => {
        const state = activityState(r.kind, r.status);
        return state === null ? null : (
          <li key={r.id} className="activity__row" data-state={state}>
            <a href={r.url} className="activity__link">
              <span className="activity__kind">{t(`crossing.kind.${r.kind}`)}</span>
              <span className="activity__asset mono">{r.chain ? `${r.asset} · ${r.chain}` : r.asset}</span>
              <span className="activity__state">{t(`activity.state.${state}`)}</span>
              <time className="activity__time" dateTime={new Date(r.createdAt).toISOString()}>
                {when.format(r.createdAt)}
              </time>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function ActivityPage({ config, wallet }: { config: LoadedConfig | null; wallet: Wallet }) {
  const { t, lang } = useText();
  const evm = useEvm();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const evmAddress = evm.connected?.address ?? null;
  const derived = wallet.view?.derived ?? null;
  const max = config?.activity.maxAddresses ?? 0;
  const addresses = config ? activityAddresses(derived ?? [], evmAddress, max) : [];
  const key = addresses.join(',');

  // The answer belongs to one set of addresses; a new set shows "busy" until its own answer arrives.
  const list: List = key === '' ? { at: 'idle' } : answer?.key === key ? answer : { at: 'busy' };

  useEffect(() => {
    if (key === '') return;
    let live = true;
    api
      .post<{ crossings: ActivityRow[] }>('/api/activity', { addresses: key.split(',') })
      .then((r) => live && setAnswer({ key, at: 'ok', rows: r.crossings }))
      .catch(() => live && setAnswer({ key, at: 'error' }));
    return () => {
      live = false;
    };
  }, [key]);

  if (!config) return <p className="card__note">{t('crossing.loading')}</p>;
  return (
    <section className="crossing activity" data-activity={list.at}>
      <h1 className="crossing__title">{t('activity.title')}</h1>
      <p className="crossing__status">{t('activity.intro')}</p>
      <FindTx />
      <div className="activity__mine">
        <h2 className="activity__heading">{t('activity.list.title')}</h2>
        {key === '' ? <p className="activity__note">{t(wallet.status === 'scanning' ? 'wallet.scanning' : 'activity.list.connect')}</p> : null}
        {wallet.session ? null : (
          <button type="button" className="button button--quiet" disabled={wallet.status === 'connecting'} onClick={wallet.connect}>
            {t(wallet.status === 'connecting' ? 'wallet.connecting' : 'wallet.connect')}
          </button>
        )}
        <EvmWallets chain={symbolList(config.evm.chains.map((c) => c.name), t('text.and'))} config={config} />
        {list.at === 'busy' ? <p className="activity__note">{t('crossing.loading')}</p> : null}
        {list.at === 'error' ? (
          <p className="swap__error" role="alert">
            {t('activity.list.error')}
          </p>
        ) : null}
        {list.at === 'ok' ? <Rows rows={list.rows} lang={lang} /> : null}
      </div>
      {wallet.status === 'connecting' && wallet.uri && wallet.qrUri ? (
        <ConnectDialog uri={wallet.uri} qrUri={wallet.qrUri} onClose={() => void wallet.disconnect()} />
      ) : null}
    </section>
  );
}
