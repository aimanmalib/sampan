// The receipt of a crossing out or in, from the route's status and the quote the crossing was built from
// (core/receipt). Kept on the row once the crossing is final and its payout is known, so it outlives the quote
// payload (cleared after ops.quotePayloadHours) and the page no longer asks the route.
import type { SampanConfig } from '../../core/config.js';
import { bchPriceOf, receiptOf, type ReceiptLeg } from '../../core/receipt.js';
import type { CrossingRow } from '../db.js';
import type { CrossingStatus } from '../routes/types.js';
import { jsonSafe, splitRowAsset } from './wire.js';

export interface StoredReceipt {
  stage: 'done' | 'refunded';
  outTxid: string;
  outChain: string | null;
  receipt: unknown;
}

const quoteOf = (row: CrossingRow): Record<string, unknown> | null => {
  if (!row.quote_json) return null;
  const q = (JSON.parse(row.quote_json) as { quote?: unknown }).quote;
  return q && typeof q === 'object' ? (q as Record<string, unknown>) : null;
};

/** The receipt as /api/crossings/:id sends it (amounts as decimal strings); null while the crossing is not final. */
export function receiptFor(config: SampanConfig, row: CrossingRow, st: CrossingStatus, now: number): unknown {
  if ((row.kind !== 'out' && row.kind !== 'in') || !row.txid || (st.stage !== 'done' && st.stage !== 'refunded')) return null;
  const kind = row.kind;
  const stableChain = splitRowAsset(row.asset).chain ?? '';
  const legs: ReceiptLeg[] = [
    { chain: kind === 'out' ? 'BCH' : stableChain, txid: row.txid },
    ...(st.inboundTxid ? [{ chain: 'THOR', txid: st.inboundTxid }] : []),
    ...(st.outTxid ? [{ chain: st.outChain ?? (kind === 'out' ? stableChain : 'BCH'), txid: st.outTxid }] : []),
  ];
  const stables = new Set(config.thorchain.assets.map((a) => a.asset.toUpperCase()));
  return jsonSafe(
    receiptOf({
      kind,
      legs,
      refunded: st.stage === 'refunded',
      ...(st.paid ? { paid: st.paid } : {}),
      ...(st.received ? { received: st.received } : {}),
      price: bchPriceOf(kind, quoteOf(row)),
      stable: (asset) => stables.has(asset.toUpperCase()),
      seconds: Math.max(0, Math.round((now - row.created_at) / 1000)),
    }),
  );
}

/** Worth keeping: final, paid out, both amounts known. */
export const keepable = (st: CrossingStatus): st is CrossingStatus & { stage: 'done' | 'refunded'; outTxid: string } =>
  (st.stage === 'done' || st.stage === 'refunded') && !!st.outTxid && !!st.paid && !!st.received;
