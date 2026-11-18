// An opened landing address on the "Bring in" card: QR code, address, amount and the one primary button. While the
// QR is open the card asks GET /api/crossings/:id every `landing.pagePollSeconds`, only while the tab is visible.
// A payment seen there, or one just made from the connected wallet, closes the QR code first; then the ferry moves
// and is scrolled into view; once the token has landed one arrival plays (ferry/reveal.ts). After a wallet payment
// the page goes on to the status link, but only when the arrival is over. Mounted again (new key) for each address.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckFailure, type SwapStep } from '../../../core/client/swap';
import { bip21, LandingMismatch, payLanding, type OpenedLanding } from '../../../core/client/land';
import { cardToFragment } from '../../../core/landing-card';
import { formatUnits, parseUnits } from '../../../core/wallet';
import { ApiFailure } from '../../../core/client/api';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import { UnitChip } from '../chips/Chip';
import { useText, type TextKey } from '../i18n';
import { codeKey, errorKey } from '../swap/errors';
import type { Wallet } from '../wallet/useWallet';
import { Ferry, useBanks } from '../ferry/Ferry';
import { ferryStep } from '../ferry/step';
import { WizardHat } from '../wallet/WizardHat';
import { PayQr } from './PayQr';
import { useReveal } from './useReveal';

const BCH_DECIMALS = 8;
/** Statuses after which nothing changes at the address: the token landed, or the BCH went back. */
const FINAL = new Set(['converted', 'returned', 'failed']);

export const statusLink = (l: OpenedLanding): string => `/c/${l.crossingId}#card=${cardToFragment(l.card)}`;

export function failureKey(e: unknown): TextKey {
  if (e instanceof LandingMismatch) return 'land.err.mismatch';
  if (e instanceof ApiFailure && e.code === 'flow_closed') return 'land.err.closed';
  if (e instanceof ApiFailure) return codeKey(e.code);
  if (e instanceof CheckFailure) return 'swap.err.check';
  return errorKey(e);
}

type Pay = { at: 'idle' } | { at: 'paying'; step: SwapStep } | { at: 'paid' };

export function LandOpen({
  config,
  wallet,
  landing,
  amountText,
  setAmountText,
  onNew,
}: {
  config: LoadedConfig;
  wallet: Wallet;
  landing: OpenedLanding;
  amountText: string;
  setAmountText: (v: string) => void;
  onNew: () => void;
}) {
  const { t } = useText();
  const token = config.tokens[config.defaultToken]!;
  const banks = useBanks('land', { symbol: token.symbol });
  const { phase, attrs, reduced, saw, cssRoot } = useReveal(config.ui);
  const [pay, setPay] = useState<Pay>({ at: 'idle' });
  const [status, setStatus] = useState('open');
  /** The status when the card opened. Only an address still open then is watched: a reused one that already landed
   * keeps its old status whatever arrives next, so the page cannot tell a new payment from it. */
  const [baseline, setBaseline] = useState<string | null>(null);
  const [error, setError] = useState<TextKey | null>(null);
  const [copied, setCopied] = useState(false);
  const ferryRef = useRef<HTMLDivElement | null>(null);

  const view = wallet.view;
  const sats = parseUnits(amountText, BCH_DECIMALS);
  const minSats = BigInt(config.limits.localMinSats);
  const amountOk = sats !== undefined && sats >= minSats;
  const vars = { symbol: token.symbol, min: formatUnits(minSats, BCH_DECIMALS) };
  const final = FINAL.has(status);
  const pollMs = config.landing.pagePollSeconds * 1000;

  const ask = useCallback(() => {
    api.get<{ status: string }>(`/api/crossings/${landing.crossingId}`).then(
      (c) => {
        setStatus(c.status);
        saw({ detected: c.status !== 'open', arrived: FINAL.has(c.status) });
      },
      () => undefined,
    );
  }, [landing.crossingId, saw]);

  useEffect(() => {
    api.get<{ status: string }>(`/api/crossings/${landing.crossingId}`).then(
      (c) => {
        setStatus(c.status);
        setBaseline(c.status);
      },
      () => setBaseline('unknown'),
    );
  }, [landing.crossingId]);

  const watching = baseline === 'open' && !final;
  useEffect(() => {
    if (!watching) return;
    const tick = (): void => {
      if (document.visibilityState === 'visible') ask();
    };
    const timer = setInterval(tick, pollMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [watching, pollMs, ask]);

  const closed = attrs.qr === 'closed';
  useEffect(() => {
    if (closed) ferryRef.current?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [closed, reduced]);

  // A wallet payment leaves for the status link once the arrival is over (no fetch is in flight by then); on an
  // address that was not open any more, as soon as the QR has closed (no arrival can be told apart there).
  const leave = pay.at === 'paid' && (baseline === 'open' ? attrs.arrive === 'done' : closed);
  useEffect(() => {
    if (leave) location.assign(statusLink(landing));
  }, [leave, landing]);

  const payNow = async (): Promise<void> => {
    if (!wallet.session || !view || sats === undefined) return;
    setError(null);
    try {
      await payLanding({
        api,
        session: wallet.session,
        wallet: view,
        landing,
        sats,
        feeCapSats: BigInt(config.connect.feeCapSats),
        userPrompt: t('land.prompt', { amount: amountText }),
        onStep: (step) => setPay({ at: 'paying', step }),
      });
      setPay({ at: 'paid' });
      saw({ detected: true, arrived: false });
      if (baseline === 'open') ask();
    } catch (e) {
      setError(failureKey(e));
      setPay({ at: 'idle' });
    }
  };

  const address = landing.card.address;
  const link = bip21(address, amountOk ? amountText.trim() : '');
  const paying = pay.at !== 'idle';
  const primary = wallet.session
    ? {
        label: pay.at === 'paying' ? t(`swap.step.${pay.step}`) : pay.at === 'paid' ? t('land.paid') : t('land.pay'),
        disabled: paying || !view || !amountOk || (view !== null && sats !== undefined && sats > view.sats),
        onClick: () => void payNow(),
      }
    : { label: wallet.status === 'connecting' ? t('wallet.connecting') : t('land.connectToPay'), disabled: wallet.status === 'connecting', onClick: wallet.connect, hat: true };
  // The ferry shows no step the reveal has not reached: still while the QR is open, crossing once it has closed.
  const shown = phase === 'qr' || phase === 'closing' ? 'open' : phase === 'moving' ? 'seen' : status;

  return (
    <div className="land land--open" ref={cssRoot}>
      <h3 className="land__title">{t('land.addressTitle')}</h3>
      {config.ui.ferryMotion ? (
        <div className="land__ferry" ref={ferryRef}>
          <Ferry kind="land" at={ferryStep('land', { status: shown, txid: null })} banks={banks} motion={attrs.arrive === 'moving'} arrive={attrs.arrive} />
        </div>
      ) : null}
      <p className="land__detected" aria-live="polite">
        {phase === 'qr' ? '' : t('land.detected')}
      </p>
      <div className="land__qr" data-qr={attrs.qr}>
        {closed ? null : (
          <div className="land__pay">
            <PayQr
              value={link}
              label={t('land.qrLabel', { amount: amountOk ? amountText.trim() : vars.min })}
              copy={{ label: t('land.qrCopy'), done: t('land.copied') }}
            />
            <div className="land__details">
              <p className="land__address mono">{address}</p>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => void navigator.clipboard?.writeText(address).then(() => setCopied(true), () => setCopied(false))}
              >
                {copied ? t('land.copied') : t('land.copy')}
              </button>
            </div>
          </div>
        )}
      </div>
      {closed ? null : (
        <>
          <label className="field">
            <span className="field__label">{t('land.amount')}</span>
            <span className="field__row">
              <input
                className="field__input"
                inputMode="decimal"
                autoComplete="off"
                value={amountText}
                disabled={paying}
                onChange={(e) => setAmountText(e.target.value)}
              />
              <UnitChip config={config} name="BCH" />
            </span>
          </label>
          <p className="card__note">{t('land.min', { ...vars, tokens: formatUnits(landing.tokensMin, token.decimals, token.decimals) })}</p>
          {!amountOk && amountText.trim() !== '' ? <p className="swap__error">{t('swap.err.below_min', vars)}</p> : null}
          <p className="card__note">{t('land.promise', { symbol: token.symbol, pct: String(config.landing.toleranceBpsDirect / 100) })}</p>
          <p className="card__note">{t('land.validity', { hours: String(landing.validHours) })}</p>
          {error ? (
            <p className="swap__error" role="alert">
              {t(error, { min: vars.min, max: String(config.limits.maxUsd) })}
            </p>
          ) : null}
          <button type="button" className="button button--primary" disabled={primary.disabled} onClick={primary.onClick}>
            {primary.hat ? <WizardHat /> : null}
            {primary.label}
          </button>
          {!wallet.session ? <p className="card__note">{t('land.noWallet')}</p> : null}
        </>
      )}
      <p className="swap__links">
        <a href={statusLink(landing)}>{t('land.follow')}</a>
        <button type="button" className="link-button" disabled={paying} onClick={onNew}>
          {t('land.new')}
        </button>
      </p>
    </div>
  );
}
