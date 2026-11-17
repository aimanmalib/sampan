// WizardConnect pairing: the library's QR code inside Sampan's own dialog (translated labels, 44 px targets,
// Escape to close, no blurred backdrop), plus "Copy link" for a wallet on the same phone.
import { useMemo, type ReactNode } from 'react';
import { AlphanumericQRCode } from '@wizardconnect/react';
import { useText } from '../i18n';
import { CopyLink, Dialog } from './Dialog';

const QR_SIZE = 240;

/** QR colours read from the CSS tokens, so the code follows styles.css. */
function qrColours(): { foreground: string; background: string } {
  const css = getComputedStyle(document.documentElement);
  return { foreground: css.getPropertyValue('--ink').trim(), background: css.getPropertyValue('--card').trim() };
}

export function ConnectDialog(props: { uri: string; qrUri: string; onClose: () => void; children?: ReactNode }) {
  const { t } = useText();
  const colours = useMemo(() => qrColours(), []);
  return (
    <Dialog title={t('wallet.dialogTitle')} onClose={props.onClose}>
      <p className="connect__text">{t('wallet.scan')}</p>
      <div className="connect__qr">
        <AlphanumericQRCode value={props.qrUri} size={QR_SIZE} foreground={colours.foreground} background={colours.background} />
      </div>
      <CopyLink value={props.uri} />
      <p className="connect__text">{t('wallet.pasteHint')}</p>
      {props.children}
    </Dialog>
  );
}
