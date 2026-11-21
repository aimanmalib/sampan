// Shown when a wallet that was connected has disconnected: what happened, as text above the panel. The panel's own
// primary button is the one action (it reads Connect again while the status is 'lost'), so the card keeps one button.
import { useText } from '../i18n';
import type { Wallet } from './useWallet';

type T = ReturnType<typeof useText>['t'];

/** Label of the panels' connect button: Connecting while pairing, Connect again after a lost wallet, else Connect wallet. */
export function connectLabel(status: Wallet['status'], t: T): string {
  if (status === 'connecting') return t('wallet.connecting');
  return t(status === 'lost' ? 'wallet.lost.again' : 'wallet.connect');
}

export function LostNotice(props: { wallet: Wallet }) {
  const { t } = useText();
  if (props.wallet.status !== 'lost') return null;
  return (
    <div className="wallet-lost" role="alert">
      <p className="wallet-lost__title">
        <svg className="wallet-lost__icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.5v4.25M8 10.75v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
        {t('wallet.lost.title')}
      </p>
      <p className="wallet-lost__body">{t('wallet.lost.body')}</p>
    </div>
  );
}
