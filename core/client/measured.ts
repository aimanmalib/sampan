// The "Measured" line, as text parts in page order. Rows from the team's wallets count in the total but never as other
// people's; that part is left out while it is zero.

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
  if (s.public.completed > 0) parts.push(t('measured.public', { p: String(s.public.completed) }));
  const m = s.all.medianSeconds;
  if (m !== null) {
    const time = m < SECONDS_UP_TO ? t('measured.seconds', { n: String(Math.max(1, Math.round(m))) }) : t('measured.minutes', { n: String(Math.round(m / 60)) });
    parts.push(t('measured.median', { time }));
  }
  parts.push(t('measured.returned', { k: String(s.all.returned) }), t('measured.lost', { l: String(s.all.lost) }));
  return parts;
}
