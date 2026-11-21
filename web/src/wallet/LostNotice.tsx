// Shown when a wallet that was connected has disconnected: what happened and one button to pair again.
import { useText } from '../i18n';
import type { Wallet } from './useWallet';

export function LostNotice(props: { wallet: Wallet }) {
  const { t } = useText();
  if (props.wallet.status !== 'lost') return null;
  return (
    <div className="wallet-lost" role="alert">
      <p className="wallet-lost__title">{t('wallet.lost.title')}</p>
      <p className="wallet-lost__body">{t('wallet.lost.body')}</p>
      <button type="button" className="button button--primary" onClick={props.wallet.connect}>
        {t('wallet.lost.again')}
      </button>
    </div>
  );
}
