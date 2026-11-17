// The atomic swap run inside Bring in (USDC on Base to PUSD) or Send out (PUSD to USDC on Base), shown when the user
// picked that row in "Choose a route". The recovery card is downloaded before the lock or payment button works; the
// page then follows the swap, claims once its own check of the maker's lock passes, and offers the refund once the
// chain is past the lock's timeout. Every stop is said in words, with the client's short code where it helps.
import type { LoadedConfig } from '../config';
import type { EvmProvider } from '../evm/store';
import { useText, type TextKey } from '../i18n';
import { REASONS, reasonText } from './RouteChoice';
import { offerProblem } from './run';
import { useAtomSwap } from './useAtomSwap';
import type { AtomFlow, AtomPaymentRequest } from './client';
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

/** Words that differ by direction: what the user locks, where the result arrives. */
const STATE_OUT = ['userLocked', 'makerLocked', 'secretSeen', 'done'];

export interface AtomSwapProps {
  config: LoadedConfig;
  ready: AtomReady;
  flow: AtomFlow;
  /** Decimal amount the user sends (USDC or PUSD), or null while the amount is not usable. */
  amount: string | null;
  /** The BCH address that receives PUSD (or gets PUSD back on a refund), or null while it is not valid. */
  userBch: string | null;
  /** The Base address that sends USDC (or receives it), or null while it is not valid. */
  userEvm: string | null;
  /** The EVM wallet: locks USDC, and may send a Base refund itself. */
  evm: { address: string; provider: EvmProvider } | null;
  /** PUSD to USDC: pays the contract from the connected BCH wallet and returns the txid; null while not connected. */
  payBch?: ((request: AtomPaymentRequest) => Promise<string>) | null;
}

export function AtomSwap({ config, ready, flow, amount, userBch, userEvm, evm, payBch = null }: AtomSwapProps) {
  const { t } = useText();
  const run = useAtomSwap(config, ready, flow);
  const { phase, swap, downloaded, step, activity, refundable, problem } = run.state;
  const out = flow === 'pusd-to-usdc';
  const symbol = ready.shipped.tokens.usdc.symbol;
  const token = ready.shipped.tokens.pusd.symbol;
  /** What the user locks: USDC in, PUSD out. */
  const sent = out ? token : symbol;
  const receive = run.amounts ? (
    <p className="swap__receive">{out ? t('atom.receiveOut', { amount: run.amounts.out, symbol }) : t('atom.receive', { amount: run.amounts.out })}</p>
  ) : null;
  const alert = problem ? (
    <p className="swap__error" role="alert">
      {problemText(t, problem)}
    </p>
  ) : null;

  if (phase === 'idle' || phase === 'starting') {
    const canLock = out ? payBch !== null : evm !== null;
    const canStart = phase === 'idle' && amount !== null && userBch !== null && userEvm !== null && canLock;
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
        {!canLock ? <p className="card__note">{out ? t('atom.needBch', { token }) : t('atom.needEvm', { symbol })}</p> : null}
        {alert}
        <button
          type="button"
          className="button button--primary"
          disabled={!canStart}
          onClick={() => amount && userBch && userEvm && run.start({ amount, userBch, userEvm })}
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
        <p className="card__note">{t('atom.card.why', { symbol: sent })}</p>
        {receive}
        <button type="button" className="button button--quiet" disabled={locking} onClick={run.download}>
          {t('atom.card.download')}
        </button>
        {downloaded ? <p className="card__note">{t('atom.card.saved')}</p> : null}
        {alert}
        <button
          type="button"
          className="button button--primary"
          disabled={!downloaded || locking || (out ? payBch === null : evm === null)}
          onClick={() => {
            if (out && payBch) run.lock({ kind: 'bch', pay: payBch });
            else if (!out && evm) run.lock({ kind: 'base', wallet: evm.provider });
          }}
        >
          {locking && step
            ? t(`atom.step.${step}`)
            : out
              ? t('atom.pay', { amount: run.amounts?.in ?? '', token })
              : t('atom.lock', { amount: run.amounts?.in ?? '', symbol })}
        </button>
      </div>
    );
  }

  const state = swap?.state ?? 'offered';
  const stateKey = (out && STATE_OUT.includes(state) ? `atom.stateOut.${state}` : `atom.state.${state}`) as TextKey;
  const line = activity ? t(`atom.${activity}`) : t(stateKey, { symbol });
  const final = state === 'done' || state === 'refunded' || state === 'expired' || state === 'failed';
  return (
    <div className="atom-run" data-state={state}>
      {receive}
      <p className="atom-run__state" role="status" aria-live="polite">
        {line}
      </p>
      {alert}
      {refundable && !final ? (
        <div className="atom-run__refund">
          <p className="card__note">{t('atom.refund.ready')}</p>
          <button type="button" className="button button--primary" disabled={activity === 'refunding'} onClick={() => run.refund(evm?.provider ?? null)}>
            {t('atom.refund.go')}
          </button>
        </div>
      ) : null}
      {final || problem ? (
        <button type="button" className="button button--primary" onClick={run.reset}>
          {t('atom.again')}
        </button>
      ) : null}
    </div>
  );
}
