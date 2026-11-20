// The "Measured" line, as text parts in page order. Rows from the team's wallets count in the total but never as other
// people's; the outside-the-team part (swaps, landings and crossings) is left out while it is zero.

export type MeasuredKey =
  | 'measured.completed'
  | 'measured.public'
  | 'measured.median'
  | 'measured.seconds'
  | 'measured.minutes'
  | 'measured.returned'
  | 'measured.lost';

export interface Counts {
  completed: number;
  /** Swaps that reached the network. Older servers leave it out. */
  swaps?: number;
  returned: number;
  lost: number;
  medianSeconds: number | null;
}
export interface Stats {
  all: Counts;
  public: Counts;
}

/** Seconds under this many are shown as seconds, longer times as whole minutes. */
export const SECONDS_UP_TO = 120;

export function measuredParts(s: Stats, t: (key: MeasuredKey, vars?: Record<string, string>) => string): string[] {
  const parts = [t('measured.completed', { n: String(s.all.completed) })];
  const outside = s.public.completed + (s.public.swaps ?? 0);
  if (outside > 0) parts.push(t('measured.public', { p: String(outside) }));
  const m = s.all.medianSeconds;
  if (m !== null) {
    const time = m < SECONDS_UP_TO ? t('measured.seconds', { n: String(Math.max(1, Math.round(m))) }) : t('measured.minutes', { n: String(Math.round(m / 60)) });
    parts.push(t('measured.median', { time }));
  }
  parts.push(t('measured.returned', { k: String(s.all.returned) }), t('measured.lost', { l: String(s.all.lost) }));
  return parts;
}

/** The proof headline: counted from docs/MEASURED.md when the page is built, by the counter of the README bounty table. */
export interface Headline {
  crossings: number;
  chains: string[];
  symbols: string[];
  /** Chains with an ok crossing in each direction. */
  bothWays: string[];
  txids: number;
}

export type HeadlineKey = 'measured.headline' | 'measured.bothWays' | 'measured.txids';

/** The headline as text parts; "both ways" is left out while no chain has an ok crossing each way. */
export function headlineParts(
  h: Headline,
  t: (key: HeadlineKey, vars?: Record<string, string>) => string,
  list: (items: string[]) => string,
): string[] {
  const parts = [
    t('measured.headline', { crossings: String(h.crossings), chains: String(h.chains.length), chainNames: list(h.chains), symbols: list(h.symbols) }),
  ];
  if (h.bothWays.length > 0) parts.push(t('measured.bothWays', { names: list(h.bothWays) }));
  parts.push(t('measured.txids', { n: String(h.txids) }));
  return parts;
}
