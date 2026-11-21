// Moving through /slides, as pure functions the page and tests/slides-nav.test.ts share: the slide named in the address
// (#3 = slide 3), the step a key asks for and the step a sideways swipe asks for.

/** The 0-based slide that `#n` names (1-based in the address), or the first slide when the hash names none. */
export function slideFromHash(hash: string, total: number): number {
  const m = /^#(\d+)$/.exec(hash);
  if (!m || total < 1) return 0;
  return Math.min(Math.max(Number(m[1]), 1), total) - 1;
}

/** The address of a 0-based slide. */
export const hashOf = (index: number): string => `#${index + 1}`;

/** The slide a key moves to from `index`; the same index for keys the deck does not use. */
export function keyTarget(key: string, index: number, total: number): number {
  const last = total - 1;
  switch (key) {
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
      return Math.min(index + 1, last);
    case 'ArrowLeft':
    case 'PageUp':
      return Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return index;
  }
}

/** +1 (next) for a swipe to the left, -1 for one to the right, 0 when it is short or more up and down than sideways. */
export function swipeStep(dx: number, dy: number, minPx: number): -1 | 0 | 1 {
  if (Math.abs(dx) < minPx || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/** The scale that fits a `w` x `h` slide inside a `boxW` x `boxH` area (larger or smaller than 1). */
export const fitScale = (boxW: number, boxH: number, w: number, h: number): number => Math.max(Math.min(boxW / w, boxH / h), 0);
