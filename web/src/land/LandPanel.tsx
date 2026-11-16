// Tab "Bring in", default source "BCH from any wallet": a landing address that turns any BCH it receives into the
// token for its owner. The address is recomputed in this browser from the card the server sends; a mismatch is
// shown as an error and no address is displayed. One primary button at every step.
import { useState } from 'react';
import { parseAddress } from '../../../core/address';
import { CheckFailure } from '../../../core/client/swap';
import { bip21, LandingMismatch, openLanding, payLanding, type OpenedLanding } from '../../../core/client/land';
import { cardToFragment } from '../../../core/landing-card';
import { formatUnits, parseUnits } from '../../../core/wallet';
import { shortAddress } from '../address';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import { codeKey, errorKey } from '../swap/errors';
import type { Wallet } from '../wallet/useWallet';
import type { SwapStep } from '../../../core/client/swap';
import { ApiFailure } from '../../../core/client/api';
import { PayQr } from './PayQr';
import { Ferry, useBanks } from '../ferry/Ferry';
import { ferryStep } from '../ferry/step';

const BCH_DECIMALS = 8;

type Phase =
  | { at: 'form' }
  | { at: 'opening' }
  | { at: 'open'; landing: OpenedLanding }
  | { at: 'paying'; landing: OpenedLanding; step: SwapStep }
  | { at: 'paid'; landing: OpenedLanding };

const statusLink = (l: OpenedLanding): string => `/c/${l.crossingId}#card=${cardToFragment(l.card)}`;

function failureKey(e: unknown): TextKey {
  if (e instanceof LandingMismatch) return 'land.err.mismatch';
  if (e instanceof ApiFailure && e.code === 'flow_closed') return 'land.err.closed';
  if (e instanceof ApiFailure) return codeKey(e.code);
  if (e instanceof CheckFailure) return 'swap.err.check';
  return errorKey(e);
}

/** "Fill this in for me" remounts the panel (new key), so every field starts again from the judge values in config. */
export function LandPanel({ config, wallet }: { config: LoadedConfig; wallet: Wallet }) {
  const { t } = useText();
  const token = config.tokens[config.defaultToken]!;
  const banks = useBanks('land', { symbol: token.symbol });
  const [ownerText, setOwnerText] = useState('');
  const [amountText, setAmountText] = useState(config.limits.judgeLandBch);
  const [phase, setPhase] = useState<Phase>({ at: 'form' });
  const [error, setError] = useState<TextKey | null>(null);
  const [copied, setCopied] = useState(false);

  const view = wallet.view;
  const owner = view ? view.receive.tokenAddress : ownerText.trim();
  const ownerOk = owner !== '' && typeof parseAddress(owner, 'bitcoincash') !== 'string';
  const sats = parseUnits(amountText, BCH_DECIMALS);
  const minSats = BigInt(config.limits.localMinSats);
  const amountOk = sats !== undefined && sats >= minSats;
  const vars = { symbol: token.symbol, min: formatUnits(minSats, BCH_DECIMALS) };

  const open = async (): Promise<void> => {
    setError(null);
    setPhase({ at: 'opening' });
    try {
      const landing = await openLanding(api, {
        ownerAddress: owner,
        token: token.symbol,
        category: token.category,
        returnAfter: config.landing.returnAfterBlocks,
        prefix: 'bitcoincash',
      });
      setPhase({ at: 'open', landing });
    } catch (e) {
      setError(failureKey(e));
      setPhase({ at: 'form' });
    }
  };

  const pay = async (landing: OpenedLanding): Promise<void> => {
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
        onStep: (step) => setPhase({ at: 'paying', landing, step }),
      });
      setPhase({ at: 'paid', landing });
      // No rescan here: the page leaves for the status link, and WebKit reports a fetch cut off by navigation as an error.
      location.assign(statusLink(landing));
    } catch (e) {
      setError(failureKey(e));
      setPhase({ at: 'open', landing });
    }
  };

  if (phase.at === 'form' || phase.at === 'opening') {
    const busy = phase.at === 'opening';
    const primary = !view && wallet.session === null && ownerText.trim() === ''
      ? { label: wallet.status === 'connecting' ? t('wallet.connecting') : t('wallet.connect'), disabled: wallet.status === 'connecting', onClick: wallet.connect }
      : { label: busy ? t('land.opening') : t('land.open'), disabled: busy || !ownerOk, onClick: () => void open() };
    return (
      <div className="land">
        <p className="land__route">
          <span className="land__route-label">{t('land.from')}</span> <strong>{t('land.source')}</strong>
          <span aria-hidden="true" className="land__arrow">→</span>
          <span className="land__route-label">{t('land.to')}</span> <strong>{token.symbol}</strong>
        </p>
        {view ? (
          <p className="land__owner">{t('land.ownerConnected', { address: shortAddress(view.receive.tokenAddress, 8, 6) })}</p>
        ) : wallet.session ? (
          <p className="land__owner">{wallet.status === 'error' ? t('wallet.scanFailed') : t('wallet.scanning')}</p>
        ) : (
          <label className="field">
            <span className="field__label">{t('land.ownerLabel', { symbol: token.symbol })}</span>
            <span className="field__row">
              <input
                className="field__input field__input--address mono"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="bitcoincash:z…"
                value={ownerText}
                disabled={busy}
                onChange={(e) => setOwnerText(e.target.value)}
              />
            </span>
          </label>
        )}
        {!view && ownerText.trim() !== '' && !ownerOk ? <p className="swap__error">{t('land.err.owner')}</p> : null}
        {error ? (
          <p className="swap__error" role="alert">
            {t(error, { min: vars.min, max: String(config.limits.maxUsd) })}
          </p>
        ) : null}
        <button type="button" className="button button--primary" disabled={primary.disabled} onClick={primary.onClick}>
          {primary.label}
        </button>
        {/* The promise sits under the one button so the next step stays on the first screen after Fill. */}
        <p className="card__note">{t('land.promise', { symbol: token.symbol, pct: String(config.landing.toleranceBpsDirect / 100) })}</p>
      </div>
    );
  }

  const landing = phase.landing;
  const address = landing.card.address;
  const link = bip21(address, amountOk ? amountText.trim() : '');
  const paying = phase.at === 'paying' || phase.at === 'paid';
  const primary = wallet.session
    ? {
        label: phase.at === 'paying' ? t(`swap.step.${phase.step}`) : phase.at === 'paid' ? t('land.paid') : t('land.pay'),
        disabled: paying || !view || !amountOk || (view !== null && sats !== undefined && sats > view.sats),
        onClick: () => void pay(landing),
      }
    : { label: wallet.status === 'connecting' ? t('wallet.connecting') : t('land.connectToPay'), disabled: wallet.status === 'connecting', onClick: wallet.connect };

  return (
    <div className="land land--open">
      <h3 className="land__title">{t('land.addressTitle')}</h3>
      {config.ui.ferryMotion ? <Ferry kind="land" at={ferryStep('land', { status: 'open', txid: null })} banks={banks} motion={false} /> : null}
      <div className="land__pay">
        <PayQr value={link} label={t('land.qrLabel', { amount: amountOk ? amountText.trim() : vars.min })} />
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
          <span className="field__unit">BCH</span>
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
        {primary.label}
      </button>
      {!wallet.session ? <p className="card__note">{t('land.noWallet')}</p> : null}
      <p className="swap__links">
        <a href={statusLink(landing)}>{t('land.follow')}</a>
        <button type="button" className="link-button" disabled={paying} onClick={() => setPhase({ at: 'form' })}>
          {t('land.new')}
        </button>
      </p>
    </div>
  );
}
