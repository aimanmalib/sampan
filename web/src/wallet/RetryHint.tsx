// Shown after "Waiting for your wallet" has lasted connect.retryHintSeconds: one line and a way out.
import { useText } from '../i18n';
import type { Wallet } from './useWallet';

export function RetryHint(props: { wallet: Wallet }) {
  const { t } = useText();
  if (!props.wallet.waitingLong) return null;
  return (
    <p className="retry-hint" role="status">
      {t('wallet.retryHint')}{' '}
      <button type="button" className="link-button" onClick={props.wallet.startAgain}>
        {t('wallet.startAgain')}
      </button>
    </p>
  );
}
