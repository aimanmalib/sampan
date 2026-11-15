// The EVM wallet line: wallets found in this browser (icon and name from the wallet), or the connected address with
// a disconnect button, or a plain sentence when this browser has none.
import { useText } from '../i18n';
import { connectEvm, disconnectEvm, shortEvm, useEvm } from './store';

export function EvmWallets({ chain }: { chain: string }) {
  const { t } = useText();
  const evm = useEvm();
  if (evm.connected) {
    return (
      <div className="evm evm--on">
        <p className="evm__who">
          {evm.connected.wallet.info.icon ? <img className="evm__icon" src={evm.connected.wallet.info.icon} alt="" width="24" height="24" /> : null}
          <span>{t('evm.connected', { name: evm.connected.wallet.info.name })}</span>
          <span className="mono">{shortEvm(evm.connected.address)}</span>
        </p>
        <button type="button" className="link-button" onClick={disconnectEvm}>
          {t('wallet.disconnect')}
        </button>
      </div>
    );
  }
  if (evm.wallets.length === 0) return <p className="evm evm--none">{t('evm.none')}</p>;
  return (
    <div className="evm">
      <p className="evm__label">{t('evm.pick', { chain })}</p>
      <ul className="evm__list">
        {evm.wallets.map((w) => (
          <li key={w.info.uuid}>
            <button type="button" className="evm__wallet" disabled={evm.connecting} onClick={() => void connectEvm(w)}>
              {w.info.icon ? <img className="evm__icon" src={w.info.icon} alt="" width="24" height="24" /> : null}
              <span>{w.info.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {evm.failed ? <p className="swap__error">{t('evm.failed')}</p> : null}
    </div>
  );
}
