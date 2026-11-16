// QR code for a BCH payment link, drawn as one SVG path in the ink colour (no canvas, no logo over the code, no
// inline styles for the CSP). Byte mode keeps the BIP21 link exactly as wallets read it.
import { useMemo } from 'react';
import { qrPath } from '../../../core/qr';

export function PayQr({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => qrPath(value), [value]);
  return (
    <svg className="payqr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect className="payqr__bg" width={size} height={size} />
      <path className="payqr__dots" d={path} />
    </svg>
  );
}
