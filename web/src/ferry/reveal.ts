// The order in which a page shows a payment it has just seen: the QR code closes first, then the ferry moves, then
// (once the token has landed) one arrival plays, then the end state stays. Pure: the caller passes the moments it
// saw the payment and the arrival, and the time now; nothing here keeps a clock. Where the boat stands still comes
// from the crossing answer alone (step.ts); this only decides when the page may show each part.
//   qr        no payment seen yet: the QR code is open
//   closing   payment seen: the QR code is closing (qrCloseMs)
//   moving    QR closed, the token has not landed yet: the ferry moves
//   arriving  landed: the one arrival animation plays (arriveMs), never before the QR has closed and the ferry has
//             been seen moving for one more beat of the same length (so a payment and a landing seen in one answer
//             still show closing, moving, arriving in that order)
//   done      the end state, still
// With reduced motion there is no closing and no arrival: the QR goes at once and the end state shows at once.

export type RevealPhase = 'qr' | 'closing' | 'moving' | 'arriving' | 'done';

export interface RevealInput {
  /** When this page saw the payment (ms), or null. */
  detectedAt: number | null;
  /** When this page saw the token land (ms), or null. A landing seen without its payment counts as both. */
  arrivedAt: number | null;
  now: number;
  qrCloseMs: number;
  arriveMs: number;
  reduced: boolean;
}

/** The DOM contract the end-to-end tests read: the QR wrapper's data-qr and the ferry's data-arrive. */
export interface RevealAttrs {
  qr: 'open' | 'closing' | 'closed';
  arrive: 'idle' | 'moving' | 'playing' | 'done';
}

const ATTRS: Record<RevealPhase, RevealAttrs> = {
  qr: { qr: 'open', arrive: 'idle' },
  closing: { qr: 'closing', arrive: 'idle' },
  moving: { qr: 'closed', arrive: 'moving' },
  arriving: { qr: 'closed', arrive: 'playing' },
  done: { qr: 'closed', arrive: 'done' },
};

export const revealAttrs = (phase: RevealPhase): RevealAttrs => ATTRS[phase];

/** The moment the arrival starts: when it was seen, but never before the QR has closed and the ferry has moved a beat. */
function arrivalStart(detectedAt: number, arrivedAt: number, qrCloseMs: number): number {
  return Math.max(arrivedAt, detectedAt + 2 * qrCloseMs);
}

export function revealPhase(i: RevealInput): RevealPhase {
  const detected = i.detectedAt ?? i.arrivedAt;
  if (detected === null) return 'qr';
  if (i.reduced) return i.arrivedAt === null ? 'moving' : 'done';
  if (i.now < detected + i.qrCloseMs) return 'closing';
  if (i.arrivedAt === null) return 'moving';
  const start = arrivalStart(detected, i.arrivedAt, i.qrCloseMs);
  if (i.now < start) return 'moving';
  return i.now < start + i.arriveMs ? 'arriving' : 'done';
}

/** The next moment the phase changes by time alone (the caller wakes up then), or null when only news can change it. */
export function nextChange(i: RevealInput): number | null {
  const detected = i.detectedAt ?? i.arrivedAt;
  if (detected === null || i.reduced) return null;
  const closed = detected + i.qrCloseMs;
  if (i.now < closed) return closed;
  if (i.arrivedAt === null) return null;
  const start = arrivalStart(detected, i.arrivedAt, i.qrCloseMs);
  if (i.now < start) return start;
  const end = start + i.arriveMs;
  return i.now < end ? end : null;
}
