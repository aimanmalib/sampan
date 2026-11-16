// Where a crossing stands, read from the answer of GET /api/crossings/:id and nothing else (no clock, no timer).
// The timeline and the ferry both read this one function, so the boat and the words cannot disagree.
//   land: address open -> payment seen on chain -> converted by the finisher -> token at the owner's address
//         (or, when the BCH goes back: open -> seen -> returned, the boat turns back to the bank it left)
//   out / in: deposit sent -> seen by the route -> paid on the second chain (refunded = the boat turns back)
//   swap: built -> sent

export type FerryKind = 'land' | 'out' | 'in' | 'swap';
export type FerryState = 'moving' | 'arrived' | 'returned' | 'failed';

/** The fields of a crossing answer the steps depend on. */
export interface FerryView {
  status: string;
  txid: string | null;
  out?: { stage: string } | null;
}

export interface FerryStep {
  /** Timeline steps, in order; their words live in lang/ under the page's prefix. */
  steps: readonly string[];
  /** Timeline steps done (0 when nothing has happened yet, e.g. a crossing out not sent). */
  done: number;
  /** Where the boat is, 1 (first bank) to `of` (far bank); a returned boat is back at 1. */
  step: number;
  of: number;
  state: FerryState;
  /** Money is on board: the coin shows from this answer on. */
  paid: boolean;
}

export const LAND_STEPS = ['waiting', 'seen', 'converted', 'arrived'] as const;
export const LAND_RETURNED_STEPS = ['waiting', 'seen', 'returned'] as const;
export const CROSS_STEPS = ['sent', 'seen', 'delivered'] as const;
export const SWAP_STEPS = ['built', 'broadcast'] as const;

const make = (steps: readonly string[], done: number, state: FerryState, paid: boolean): FerryStep => ({
  steps,
  done,
  step: state === 'returned' ? 1 : Math.min(Math.max(done, 1), steps.length),
  of: steps.length,
  state,
  paid,
});

function land(v: FerryView): FerryStep {
  switch (v.status) {
    case 'converted':
      return make(LAND_STEPS, 4, 'arrived', true);
    case 'returned':
      return make(LAND_RETURNED_STEPS, 3, 'returned', true);
    case 'seen':
      return make(LAND_STEPS, 2, 'moving', true);
    case 'failed':
      return make(LAND_STEPS, 1, 'failed', false);
    default:
      // 'open' and any status this page does not know: the first step, never further.
      return make(LAND_STEPS, 1, 'moving', false);
  }
}

function cross(v: FerryView): FerryStep {
  const stage = v.out?.stage;
  if (v.status === 'refunded' || stage === 'refunded') return make(CROSS_STEPS, 3, 'returned', true);
  if (v.status === 'completed' || stage === 'done') return make(CROSS_STEPS, 3, 'arrived', true);
  if (!v.txid) return make(CROSS_STEPS, 0, v.status === 'failed' ? 'failed' : 'moving', false);
  const done = stage === 'pending' ? 2 : 1;
  return make(CROSS_STEPS, done, v.status === 'failed' ? 'failed' : 'moving', true);
}

function swap(v: FerryView): FerryStep {
  if (v.status === 'broadcast') return make(SWAP_STEPS, 2, 'arrived', true);
  if (v.status === 'failed') return make(SWAP_STEPS, 0, 'failed', false);
  // A stale build will not be sent any more: it stays on the first bank, still.
  if (v.status === 'stale') return make(SWAP_STEPS, 1, 'failed', false);
  return make(SWAP_STEPS, 1, 'moving', false);
}

export function ferryStep(kind: FerryKind, view: FerryView): FerryStep {
  if (kind === 'land') return land(view);
  if (kind === 'swap') return swap(view);
  return cross(view);
}
