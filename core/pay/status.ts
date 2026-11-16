// Invoice status (vocabulary after BTCPay Greenfield). Pure: the status follows from the payments seen at the
// invoice address, the time and the tolerances, so it can be recomputed at any moment. Payments are summed: two
// payments that together reach requiredSats make the invoice paid. A payment first seen after expiresAt still
// reaches the merchant (the contract does not know the time), so it is reported as paid_late, not dropped.

export type InvoiceStatus = 'open' | 'paid' | 'underpaid' | 'overpaid' | 'expired' | 'paid_late';

export interface SeenPayment {
  /** Satoshis of the coin that arrived at the invoice address. */
  sats: bigint;
  /** When the server first saw it (ms since epoch). */
  seenAt: number;
}

export interface StatusInput {
  requiredSats: bigint;
  expiresAt: number;
  payments: SeenPayment[];
}

export interface Tolerances {
  underToleranceBps: number;
  overToleranceBps: number;
}

export const paidSats = (payments: SeenPayment[]): bigint => payments.reduce((sum, p) => sum + p.sats, 0n);

export function invoiceStatus(i: StatusInput, now: number, t: Tolerances): InvoiceStatus {
  if (i.payments.length === 0) return now >= i.expiresAt ? 'expired' : 'open';
  const first = Math.min(...i.payments.map((p) => p.seenAt));
  if (first >= i.expiresAt) return 'paid_late';
  const total = paidSats(i.payments);
  const low = (i.requiredSats * BigInt(10_000 - t.underToleranceBps)) / 10_000n;
  const high = (i.requiredSats * BigInt(10_000 + t.overToleranceBps)) / 10_000n;
  if (total < low) return 'underpaid';
  if (total > high) return 'overpaid';
  return 'paid';
}

/** No later payment can change the status any more except to add to it (open and early underpaid can still move). */
export const isSettled = (status: InvoiceStatus, now: number, expiresAt: number): boolean =>
  status === 'open' ? false : status === 'underpaid' ? now >= expiresAt : true;
