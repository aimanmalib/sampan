// QR code for a BCH payment link, drawn as one SVG path in the ink colour (no canvas, no logo over the code, no
// inline styles for the CSP). Byte mode keeps the BIP21 link exactly as wallets read it.
import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

const QUIET = 4;

export function PayQr({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
    }
    return { size: n + 2 * QUIET, path: d };
  }, [value]);
  return (
    <svg className="payqr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect className="payqr__bg" width={size} height={size} />
      <path className="payqr__dots" d={path} />
    </svg>
  );
}
