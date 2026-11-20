// The status chips under the front page's headline (K5P2): one per chain a crossing can reach, open or paused, read
// from the same network rows the Send out and Bring in panels list, plus the PUSD price and the pools counted.
import type { DepthReport } from './peg.js';

interface Row {
  chain: { key: string; name: string };
  open: boolean;
}

export interface ChainChip {
  key: string;
  name: string;
  open: boolean;
}

/** Each chain once, in list order: open when either direction has an open network on it. */
export function chainChips(...lists: readonly (readonly Row[])[]): ChainChip[] {
  const out = new Map<string, ChainChip>();
  for (const rows of lists) {
    for (const r of rows) {
      const seen = out.get(r.chain.key);
      if (seen) seen.open ||= r.open;
      else out.set(r.chain.key, { key: r.chain.key, name: r.chain.name, open: r.open });
    }
  }
  return [...out.values()];
}

/** The stablecoin's dollar price with four decimals from the peg reading; null when the BCH price is unknown. */
export function pegPrice(d: Pick<DepthReport, 'pegBps'>): string | null {
  return d.pegBps === null ? null : ((10_000 + d.pegBps) / 10_000).toFixed(4);
}
