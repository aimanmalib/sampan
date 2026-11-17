// QR code for a BCH payment link, drawn as one SVG path in the ink colour (no canvas, no logo over the code, no
// inline styles for the CSP). Byte mode keeps the BIP21 link exactly as wallets read it. With `copy`, the code is
// also a button that copies the same link.
import { useMemo } from 'react';
import { qrPath } from '../../../core/qr';
import { QrCopy } from '../QrCopy';

export function PayQr({ value, label, copy }: { value: string; label: string; copy?: { label: string; done: string } }) {
  const { size, path } = useMemo(() => qrPath(value), [value]);
  const svg = (
    <svg className="payqr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect className="payqr__bg" width={size} height={size} />
      <path className="payqr__dots" d={path} />
    </svg>
  );
  if (!copy) return svg;
  return (
    <QrCopy value={value} label={copy.label} done={copy.done}>
      {svg}
    </QrCopy>
  );
}
