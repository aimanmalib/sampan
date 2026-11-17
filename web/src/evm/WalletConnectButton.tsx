// WalletConnect in the EVM wallet list: the button loads the provider (lazily, see walletconnect.ts), shows the
// pairing link as a QR code with "Open in wallet app" and "Copy link", and closes once the wallet approves.
import { useCallback, useRef, useState } from 'react';
import type { LoadedConfig } from '../config';
import { useText } from '../i18n';
import { PayQr } from '../land/PayQr';
import { CopyLink, Dialog } from '../wallet/Dialog';
import { cancelEvm, connectEvm, useEvm } from './store';
import { walletConnectOptions } from '../../../core/client/walletconnect';
import { loadWalletConnect } from './walletconnect';

const WALLET_INFO = { uuid: 'walletconnect', icon: '', rdns: 'walletconnect' };

export function WalletConnectButton({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  const evm = useEvm();
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // A pairing closed by the user may still settle later; only the latest one may close the dialog.
  const run = useRef(0);

  const close = useCallback(() => {
    run.current++;
    setOpen(false);
    setUri(null);
    cancelEvm();
  }, []);

  const start = (): void => {
    const options = walletConnectOptions(config, t('evm.wc.name'), t('meta.title'), window.location.origin);
    if (!options) return;
    const mine = ++run.current;
    const done = (loadFailed: boolean): void => {
      if (mine !== run.current) return;
      setOpen(false);
      setUri(null);
      setFailed(loadFailed);
    };
    setOpen(true);
    setFailed(false);
    loadWalletConnect(options, config.fake).then(
      (provider) => {
        const wallet = { info: { ...WALLET_INFO, name: t('evm.wc.name') }, provider };
        void connectEvm(wallet, () => provider.pair((u) => mine === run.current && setUri(u))).finally(() => done(false));
      },
      () => done(true),
    );
  };

  return (
    <>
      <button type="button" className="evm__wallet" disabled={evm.connecting} onClick={start}>
        <span>{t('evm.wc.button')}</span>
      </button>
      {failed ? <p className="swap__error">{t('evm.wc.failed')}</p> : null}
      {open ? (
        <Dialog title={t('evm.wc.title')} onClose={close}>
          {uri ? (
            <>
              <p className="connect__text">{t('evm.wc.scan')}</p>
              <div className="connect__qr connect__qr--wc">
                <PayQr value={uri} label={t('evm.wc.qr')} />
              </div>
              <a className="button button--primary connect__open" href={uri}>
                {t('evm.wc.open')}
              </a>
              <CopyLink value={uri} />
            </>
          ) : (
            <p className="connect__text" role="status">
              {t('evm.wc.preparing')}
            </p>
          )}
        </Dialog>
      ) : null}
    </>
  );
}
