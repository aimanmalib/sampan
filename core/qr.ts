// QR code of a payment link as one SVG path (byte mode keeps the BIP21 link exactly as wallets read it).
// Shared by the page (web/src/land/PayQr.tsx) and the invoice QR of Sampan Pay. Pure.
import qrcode from 'qrcode-generator';

export const QR_QUIET = 4;

/** Side of the square in modules, quiet zone included, and the path of the dark modules. */
export function qrPath(value: string): { size: number; path: string } {
  const qr = qrcode(0, 'M');
  qr.addData(value, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QR_QUIET} ${r + QR_QUIET}h1v1h-1z`;
  }
  return { size: n + 2 * QR_QUIET, path: d };
}

/** Standalone SVG document (black on white) for a link that other sites embed as an image. */
export function qrSvg(value: string): string {
  const { size, path } = qrPath(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
