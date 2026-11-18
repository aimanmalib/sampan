// Runs the reveal order of ferry/reveal.ts on a page: remembers when this page saw the payment and the landing,
// wakes up only at the moments reveal.ts names (QR closed, arrival over) and hands the durations from config to
// the CSS as custom properties (set through the CSSOM, so no inline style attribute for the CSP). The ferry's
// place never comes from here: it is the crossing answer, shown no earlier than the phase allows.
import { useCallback, useEffect, useState } from 'react';
import { nextChange, revealAttrs, revealPhase, type RevealAttrs, type RevealPhase } from '../ferry/reveal';

const REDUCED = '(prefers-reduced-motion: reduce)';

interface Seen {
  detectedAt: number | null;
  arrivedAt: number | null;
  movedAt: number | null;
  now: number;
}

export interface Reveal {
  phase: RevealPhase;
  attrs: RevealAttrs;
  reduced: boolean;
  /**
   * Called with what the page just learned. `early`: the page was opened on this state (already paid), so the end
   * state shows at once, with no closing and no arrival.
   */
  saw: (news: { detected: boolean; arrived: boolean; early?: boolean }) => void;
  /** Callback ref for the element that holds the QR code and the ferry: it carries the durations for the CSS. */
  cssRoot: (el: HTMLElement | null) => void;
}

export function useReveal(ui: { qrCloseMs: number; arriveMs: number }): Reveal {
  const [reduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(REDUCED).matches === true);
  const [seen, setSeen] = useState<Seen>({ detectedAt: null, arrivedAt: null, movedAt: null, now: 0 });
  const { qrCloseMs, arriveMs } = ui;
  const input = { ...seen, qrCloseMs, arriveMs, reduced };
  const phase = revealPhase(input);
  const wake = nextChange(input);

  // The render that first shows the ferry moving starts its beat (reveal.ts), however late the timer woke.
  const stamp = useCallback(
    (s: Seen): Seen => (s.movedAt === null && revealPhase({ ...s, qrCloseMs, arriveMs, reduced }) === 'moving' ? { ...s, movedAt: s.now } : s),
    [qrCloseMs, arriveMs, reduced],
  );

  const saw = useCallback((news: { detected: boolean; arrived: boolean; early?: boolean }) => {
    setSeen((s) => {
      const t = news.early ? -Infinity : Date.now();
      const detectedAt = s.detectedAt ?? (news.detected || news.arrived ? t : null);
      const arrivedAt = s.arrivedAt ?? (news.arrived ? t : null);
      if (detectedAt === s.detectedAt && arrivedAt === s.arrivedAt) return s;
      // Opened on a paid state: the ferry counts as moved long ago, so the end state shows at once.
      const movedAt = s.movedAt ?? (news.early ? -Infinity : null);
      return stamp({ detectedAt, arrivedAt, movedAt, now: Date.now() });
    });
  }, [stamp]);

  // One timer at a time, only up to the next change; none once the end state (or the moving ferry) is reached.
  useEffect(() => {
    if (wake === null) return;
    const timer = setTimeout(() => setSeen((s) => stamp({ ...s, now: Date.now() })), Math.max(0, wake - seen.now));
    return () => clearTimeout(timer);
  }, [wake, seen.now, stamp]);

  const cssRoot = useCallback(
    (el: HTMLElement | null) => {
      el?.style.setProperty('--qr-close-ms', `${qrCloseMs}ms`);
      el?.style.setProperty('--arrive-ms', `${arriveMs}ms`);
    },
    [qrCloseMs, arriveMs],
  );

  return { phase, attrs: revealAttrs(phase), reduced, saw, cssRoot };
}
