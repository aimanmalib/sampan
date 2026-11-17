// The atomic swap run inside Bring in (USDC on Base to PUSD), shown when the user picked that row in "Choose a route".
// The recovery card is downloaded before the lock button works; the page then follows the swap and claims once its
// own check of the maker's lock passes. Every stop is said in words, with the client's short code where it helps.
import type { LoadedConfig } from '../config';
import type { EvmProvider } from '../evm/store';
import { useText, type TextKey } from '../i18n';
import { REASONS, reasonText } from './RouteChoice';
import { offerProblem } from './run';
import { useAtomSwap } from './useAtomSwap';
import type { AtomReady } from './useAtomQuote';

type T = ReturnType<typeof useText>['t'];

/** Codes from the wallet, the lock and the service that have their own sentence. */
const OWN_TEXT = ['card-first', 'wrong-chain', 'wrong-account', 'rejected', 'reverted', 'no-receipt', 'offline'];

function problemText(t: T, problem: string): string {
  const [stage, code = ''] = problem.includes(':') ? problem.split(':') : ['', problem];
  if (stage === 'maker') return t('atom.err.maker', { code });
  if (stage === 'offer' && offerProblem(code)) return t('atom.err.offer', { code });
  if (stage === 'offer' && REASONS.includes(code)) return t('compare.unavailable', { reason: reasonText(t, code) });
  if (OWN_TEXT.includes(code)) return t(`atom.err.${code}` as TextKey);
  return t('atom.err.other', { code });
}

export interface AtomSwapProps {
  config: LoadedConfig;
  ready: AtomReady;
  /** Decimal USDC amount, or null while the amount is not usable. */
  amount: string | null;
  /** The address that receives PUSD, or null while it is not valid. */
  userBch: string | null;
  evm: { address: string; provider: EvmProvider } | null;
}

export function AtomSwap({ config, ready, amount, userBch, evm }: AtomSwapProps) {
  const { t } = useText();
  const run = useAtomSwap(config, ready);
  const { phase, swap, downloaded, step, activity, problem } = run.state;
  const symbol = ready.shipped.tokens.usdc.symbol;
  const alert = problem ? (
    <p className="swap__error" role="alert">
      {problemText(t, problem)}
    </p>
  ) : null;

  if (phase === 'idle' || phase === 'starting') {
    const canStart = phase === 'idle' && amount !== null && userBch !== null && evm !== null;
    return (
      <div className="atom-run">
        {run.pending.length > 0 ? (
          <section className="atom-run__pending" aria-label={t('atom.pending.title')}>
            <h3 className="atom-run__title">{t('atom.pending.title')}</h3>
            <ul className="atom-run__list">
              {run.pending.map((s) => (
                <li key={s.card.secret.hash} className="atom-run__item">
                  <span>
                    {t('atom.pending.item', {
                      amount: run.amountIn(s),
                      symbol: s.card.flow === 'usdc-to-pusd' ? symbol : ready.shipped.tokens.pusd.symbol,
                      date: new Date(s.card.createdUtc).toLocaleString(),
                    })}
                  </span>
                  <button type="button" className="button button--quiet" onClick={() => run.resume(s)}>
                    {t('atom.pending.continue')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {evm === null ? <p className="card__note">{t('atom.needEvm', { symbol })}</p> : null}
        {alert}
        <button
          type="button"
          className="button button--primary"
          disabled={!canStart}
          onClick={() => amount && userBch && evm && run.start({ amount, userBch, userEvm: evm.address })}
        >
          {phase === 'starting' ? t('atom.starting') : t('atom.go')}
        </button>
      </div>
    );
  }

  if (phase === 'card' || phase === 'locking') {
    const locking = phase === 'locking';
    return (
      <div className="atom-run">
        <h3 className="atom-run__title">{t('atom.card.title')}</h3>
        <p className="card__note">{t('atom.card.why', { symbol })}</p>
        {run.amounts ? <p className="swap__receive">{t('atom.receive', { amount: run.amounts.out })}</p> : null}
        <button type="button" className="button button--quiet" disabled={locking} onClick={run.download}>
          {t('atom.card.download')}
        </button>
        {downloaded ? <p className="card__note">{t('atom.card.saved')}</p> : null}
        {alert}
        <button
          type="button"
          className="button button--primary"
          disabled={!downloaded || locking || evm === null}
          onClick={() => evm && run.lock(evm.provider)}
        >
          {locking && step ? t(`atom.step.${step}`) : t('atom.lock', { amount: run.amounts?.in ?? '', symbol })}
        </button>
      </div>
    );
  }

  const state = swap?.state ?? 'offered';
  const line = activity ? t(`atom.${activity}`) : t(`atom.state.${state}` as TextKey);
  const final = state === 'done' || state === 'refunded' || state === 'expired' || state === 'failed';
  return (
    <div className="atom-run" data-state={state}>
      {run.amounts ? <p className="swap__receive">{t('atom.receive', { amount: run.amounts.out })}</p> : null}
      <p className="atom-run__state" role="status" aria-live="polite">
        {line}
      </p>
      {alert}
      {final || problem ? (
        <button type="button" className="button button--primary" onClick={run.reset}>
          {t('atom.again')}
        </button>
      ) : null}
    </div>
  );
}
