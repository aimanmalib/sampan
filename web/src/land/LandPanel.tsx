// Tab "Bring in", default source "BCH from any wallet": a landing address that turns any BCH it receives into the
// token for its owner. The address is recomputed in this browser from the card the server sends; a mismatch is
// shown as an error and no address is displayed. One primary button at every step.
// With ui.qrAutoOpen the address and its QR open by themselves once the owner is known: a connected wallet, or a
// valid address pasted, left or confirmed with Enter (not on every key). Once per owner and token; a failure leaves
// the error and the button. Until then an empty frame shows where the QR code will be. The opened address, and what
// the card does once a payment to it is seen, live in LandOpen.
import { useEffect, useRef, useState } from 'react';
import { parseAddress } from '../../../core/address';
import { openLanding, type OpenedLanding } from '../../../core/client/land';
import { formatUnits } from '../../../core/wallet';
import { shortAddress } from '../address';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import type { Wallet } from '../wallet/useWallet';
import { WizardHat } from '../wallet/WizardHat';
import { failureKey, LandOpen } from './LandOpen';
import { PegNote } from '../peg/PegNote';

const BCH_DECIMALS = 8;

type Phase = { at: 'form' } | { at: 'opening' } | { at: 'open'; landing: OpenedLanding };

/** "Fill this in for me" remounts the panel (new key), so every field starts again from the judge values in config. */
export function LandPanel({ config, wallet }: { config: LoadedConfig; wallet: Wallet }) {
  const { t } = useText();
  const token = config.tokens[config.defaultToken]!;
  const [ownerText, setOwnerText] = useState('');
  const [amountText, setAmountText] = useState(config.limits.judgeLandBch);
  const [phase, setPhase] = useState<Phase>({ at: 'form' });
  const [error, setError] = useState<TextKey | null>(null);
  /** The typed owner the visitor has finished with (paste, leaving the field, Enter). */
  const [committed, setCommitted] = useState('');
  const tried = useRef(new Set<string>());

  const view = wallet.view;
  const owner = view ? view.receive.tokenAddress : ownerText.trim();
  const ownerOk = owner !== '' && typeof parseAddress(owner, 'bitcoincash') !== 'string';
  const minSats = BigInt(config.limits.localMinSats);
  const vars = { symbol: token.symbol, min: formatUnits(minSats, BCH_DECIMALS) };

  const known = view ? owner : committed === owner ? owner : '';
  const auto = config.ui.qrAutoOpen;

  const open = async (ownerAddress: string): Promise<void> => {
    setError(null);
    setPhase({ at: 'opening' });
    try {
      const landing = await openLanding(api, {
        ownerAddress,
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

  const autoKey = auto && phase.at === 'form' && known !== '' && ownerOk ? `${known}|${token.symbol}` : '';
  useEffect(() => {
    if (autoKey === '' || tried.current.has(autoKey)) return;
    tried.current.add(autoKey);
    void open(known);
    // open() is recreated on every render; the key alone decides when to open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey]);

  if (phase.at === 'form' || phase.at === 'opening') {
    const busy = phase.at === 'opening';
    const primary = !view && wallet.session === null && ownerText.trim() === ''
      ? { label: wallet.status === 'connecting' ? t('wallet.connecting') : t('wallet.connect'), disabled: wallet.status === 'connecting', onClick: wallet.connect, hat: true }
      : { label: busy ? t('land.opening') : t('land.open'), disabled: busy || !ownerOk, onClick: () => void open(owner) };
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
                onPaste={(e) => setCommitted(e.clipboardData.getData('text').trim())}
                onBlur={(e) => setCommitted(e.target.value.trim())}
                onKeyDown={(e) => e.key === 'Enter' && setCommitted(e.currentTarget.value.trim())}
              />
            </span>
          </label>
        )}
        {!view && ownerText.trim() !== '' && !ownerOk ? <p className="swap__error">{t('land.err.owner')}</p> : null}
        <PegNote />
        {error ? (
          <p className="swap__error" role="alert">
            {t(error, { min: vars.min, max: String(config.limits.maxUsd) })}
          </p>
        ) : null}
        <button type="button" className="button button--primary" disabled={primary.disabled} onClick={primary.onClick}>
          {primary.hat ? <WizardHat /> : null}
          {primary.label}
        </button>
        {/* The promise and the empty QR frame sit under the one button so it stays on the first screen after Fill. */}
        <p className="card__note">{t('land.promise', { symbol: token.symbol, pct: String(config.landing.toleranceBpsDirect / 100) })}</p>
        {auto ? (
          <div className="land__pay land__pay--waiting" data-qr="waiting">
            <div className="payqr payqr--waiting" aria-hidden="true" />
            <p className="card__note">{t('land.qrWaiting', { symbol: token.symbol })}</p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <LandOpen
      key={phase.landing.crossingId}
      config={config}
      wallet={wallet}
      landing={phase.landing}
      amountText={amountText}
      setAmountText={setAmountText}
      onNew={() => setPhase({ at: 'form' })}
    />
  );
}
