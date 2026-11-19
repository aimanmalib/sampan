// The "Watch it run" replay (/watch): how its pace compares with the measured run it replays. Pure, so the page and
// the tests share it. The replay walks a fixed number of steps of `stepMs` each; the page says honestly whether that
// is faster or slower than the real run, and by how much.

export interface ReplayPace {
  kind: 'faster' | 'slower' | 'same';
  /** How many times faster or slower, one decimal; 1 for 'same'. */
  factor: number;
  /** Length of the whole replay in seconds. */
  replaySeconds: number;
}

/** Within this ratio either way the replay counts as real speed. */
const SAME_WITHIN = 1.1;

export function replayPace(realSeconds: number, steps: number, stepMs: number): ReplayPace {
  const replaySeconds = (steps * stepMs) / 1000;
  if (!(realSeconds > 0) || !(replaySeconds > 0)) return { kind: 'same', factor: 1, replaySeconds };
  const ratio = realSeconds / replaySeconds;
  if (ratio >= SAME_WITHIN) return { kind: 'faster', factor: Math.round(ratio * 10) / 10, replaySeconds };
  if (1 / ratio >= SAME_WITHIN) return { kind: 'slower', factor: Math.round((1 / ratio) * 10) / 10, replaySeconds };
  return { kind: 'same', factor: 1, replaySeconds };
}

/** The directions /watch can replay; `dir` in the query picks one. Only the landing exists so far. */
export const WATCH_DIRS = ['land'] as const;
export type WatchDir = (typeof WATCH_DIRS)[number];

export const watchDir = (search: string): WatchDir | null => {
  const dir = new URLSearchParams(search).get('dir');
  return (WATCH_DIRS as readonly string[]).includes(dir ?? '') ? (dir as WatchDir) : null;
};
