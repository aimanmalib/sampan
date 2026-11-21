// WizardConnect pairing: the library's QR code inside Sampan's own dialog (translated labels, 44 px targets,
// Escape to close, no blurred backdrop), the wizard's hat before the title, and "Copy link" straight under the code
// for a wallet on the same phone. The QR code itself is a button that copies the same link.
import { useMemo, type ReactNode } from 'react';
import { AlphanumericQRCode } from '@wizardconnect/react';
import { useText } from '../i18n';
import { QrCopy } from '../QrCopy';
import { CopyLink, Dialog } from './Dialog';
import { WizardHat } from './WizardHat';

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
    <Dialog title={t('wallet.dialogTitle')} icon={<WizardHat className="connect__hat" />} onClose={props.onClose}>
      <p className="connect__text">{t('wallet.scan')}</p>
      <QrCopy value={props.uri} label={t('wallet.qrCopy')} done={t('wallet.qrCopied')} className="connect__qr">
        <AlphanumericQRCode value={props.qrUri} size={QR_SIZE} foreground={colours.foreground} background={colours.background} />
      </QrCopy>
      <CopyLink value={props.uri} />
      <p className="connect__text">{t('wallet.pasteHint')}</p>
      {props.children}
    </Dialog>
  );
}
