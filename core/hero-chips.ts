// The status chips under the front page's headline (K5P2): the chain chips come from core/route-claims.ts; this is the
// PUSD price from the peg reading.
import type { DepthReport } from './peg.js';

/** The stablecoin's dollar price with four decimals from the peg reading; null when the BCH price is unknown. */
export function pegPrice(d: Pick<DepthReport, 'pegBps'>): string | null {
  return d.pegBps === null ? null : ((10_000 + d.pegBps) / 10_000).toFixed(4);
}
