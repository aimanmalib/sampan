// The reveal order of web/src/ferry/reveal.ts: the QR closes before the ferry moves, the arrival never plays while
// the QR is still open or closing, and reduced motion goes straight to the end state.
import { describe, expect, it } from 'vitest';
import { nextChange, revealAttrs, revealPhase, type RevealInput, type RevealPhase } from '../web/src/ferry/reveal.js';

const base: RevealInput = { detectedAt: null, arrivedAt: null, movedAt: null, now: 0, qrCloseMs: 400, arriveMs: 2400, reduced: false };
/** A page whose timer woke on time: unless given, the ferry was shown moving the moment the QR had closed. */
function onTime(over: Partial<RevealInput>): RevealInput {
  const i = { ...base, ...over };
  const detected = i.detectedAt ?? i.arrivedAt;
  if (over.movedAt !== undefined || detected === null) return i;
  return { ...i, movedAt: i.now >= detected + i.qrCloseMs ? detected + i.qrCloseMs : null };
}
const at = (over: Partial<RevealInput>): RevealPhase => revealPhase(onTime(over));
const next = (over: Partial<RevealInput>): number | null => nextChange(onTime(over));
const ORDER: RevealPhase[] = ['qr', 'closing', 'moving', 'arriving', 'done'];

describe('revealPhase', () => {
  it('keeps the QR open until a payment is seen', () => {
    expect(at({ now: 1_000_000 })).toBe('qr');
    expect(revealAttrs('qr')).toEqual({ qr: 'open', arrive: 'idle' });
  });

  it('closes the QR first, then moves, then plays the arrival once, then stays done', () => {
    const d = 10_000;
    expect(at({ detectedAt: d, now: d })).toBe('closing');
    expect(at({ detectedAt: d, now: d + 399 })).toBe('closing');
    expect(at({ detectedAt: d, now: d + 400 })).toBe('moving');
    expect(at({ detectedAt: d, now: d + 60_000 })).toBe('moving');
    const a = d + 5_000;
    expect(at({ detectedAt: d, arrivedAt: a, now: a })).toBe('arriving');
    expect(at({ detectedAt: d, arrivedAt: a, now: a + 2399 })).toBe('arriving');
    expect(at({ detectedAt: d, arrivedAt: a, now: a + 2400 })).toBe('done');
    expect(at({ detectedAt: d, arrivedAt: a, now: a + 600_000 })).toBe('done');
  });

  it('holds an early arrival until the QR has closed and the ferry has moved one beat, then plays it in full', () => {
    const d = 10_000;
    // Landed 100 ms after the payment was seen, while the QR was still closing.
    expect(at({ detectedAt: d, arrivedAt: d + 100, now: d + 200 })).toBe('closing');
    expect(at({ detectedAt: d, arrivedAt: d + 100, now: d + 400 })).toBe('moving');
    expect(at({ detectedAt: d, arrivedAt: d + 100, now: d + 799 })).toBe('moving');
    expect(at({ detectedAt: d, arrivedAt: d + 100, now: d + 800 })).toBe('arriving');
    expect(at({ detectedAt: d, arrivedAt: d + 100, now: d + 800 + 2399 })).toBe('arriving');
    expect(at({ detectedAt: d, arrivedAt: d + 100, now: d + 800 + 2400 })).toBe('done');
  });

  it('treats a landing seen without its payment (one poll saw both) as seen at that moment, in the same order', () => {
    const a = 20_000;
    expect(at({ arrivedAt: a, now: a })).toBe('closing');
    expect(at({ arrivedAt: a, now: a + 400 })).toBe('moving');
    expect(at({ arrivedAt: a, now: a + 800 })).toBe('arriving');
    expect(at({ arrivedAt: a, now: a + 3200 })).toBe('done');
  });

  it('never runs backwards, never skips moving, and never plays while the QR is not closed, at any moment', () => {
    for (const arriveAfter of [null, 0, 50, 399, 400, 401, 3000]) {
      let last = 0;
      for (let now = 9_000; now <= 20_000; now += 25) {
        const p = at({ detectedAt: 10_000, arrivedAt: arriveAfter === null ? null : 10_000 + arriveAfter, now });
        const idx = ORDER.indexOf(p);
        expect(idx).toBeGreaterThanOrEqual(last);
        expect(idx - last).toBeLessThanOrEqual(1);
        last = idx;
        const attrs = revealAttrs(p);
        if (attrs.arrive === 'moving' || attrs.arrive === 'playing') expect(attrs.qr).toBe('closed');
      }
    }
  });

  it('shows the ferry moving for a full beat even when the timer wakes late, before the arrival plays', () => {
    const d = 10_000;
    // Landed while the QR was closing; the page woke 300 ms late, past the moment the arrival could have started.
    const late = { detectedAt: d, arrivedAt: d + 100, now: d + 1100 };
    expect(at({ ...late, movedAt: null })).toBe('moving');
    expect(nextChange({ ...base, ...late, movedAt: null })).toBeNull();
    // The page showed it moving at d + 1100: the arrival waits one beat from then.
    expect(at({ ...late, movedAt: d + 1100 })).toBe('moving');
    expect(nextChange({ ...base, ...late, movedAt: d + 1100 })).toBe(d + 1500);
    expect(at({ ...late, movedAt: d + 1100, now: d + 1500 })).toBe('arriving');
    expect(at({ ...late, movedAt: d + 1100, now: d + 1500 + 2400 })).toBe('done');
  });

  it('shows the end state at once on a page opened on a paid state', () => {
    expect(at({ detectedAt: -Infinity, arrivedAt: -Infinity, movedAt: -Infinity, now: 5 })).toBe('done');
    expect(nextChange({ ...base, detectedAt: -Infinity, arrivedAt: -Infinity, movedAt: -Infinity, now: 5 })).toBeNull();
  });

  it('with reduced motion shows the end state at once: no closing, no arrival', () => {
    expect(at({ reduced: true, detectedAt: 5, now: 5 })).toBe('moving');
    expect(at({ reduced: true, detectedAt: 5, arrivedAt: 5, now: 5 })).toBe('done');
    expect(at({ reduced: true, arrivedAt: 5, now: 5 })).toBe('done');
    expect(next({ reduced: true, detectedAt: 5, arrivedAt: 5, now: 5 })).toBeNull();
  });
});

describe('nextChange', () => {
  it('wakes the page when the QR has closed and when the arrival ends, and not otherwise', () => {
    expect(next({ now: 1 })).toBeNull();
    expect(next({ detectedAt: 1000, now: 1000 })).toBe(1400);
    expect(next({ detectedAt: 1000, now: 1400 })).toBeNull();
    expect(next({ detectedAt: 1000, arrivedAt: 1100, now: 1200 })).toBe(1400);
    expect(next({ detectedAt: 1000, arrivedAt: 1100, now: 1400 })).toBe(1800);
    expect(next({ detectedAt: 1000, arrivedAt: 1100, now: 1800 })).toBe(4200);
    expect(next({ detectedAt: 1000, arrivedAt: 5000, now: 5000 })).toBe(7400);
    expect(next({ detectedAt: 1000, arrivedAt: 5000, now: 7400 })).toBeNull();
  });
});
