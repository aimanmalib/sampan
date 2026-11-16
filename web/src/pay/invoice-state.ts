// What the invoice status page says and does at a given moment, worked out from GET /api/pay/invoice/:id alone.
// Pure, so tests can walk every status. An address is shown for paying only while a payment can still count
// (open, or underpaid before the time is up); an expired address is never offered.
import { DEMO_ORDER_PREFIX } from '../../../core/pay/config.js';
import type { InvoiceStatus } from '../../../core/pay/status.js';
import { formatUnits } from '../../../core/wallet.js';

export interface InvoiceView {
  id: string;
  status: InvoiceStatus;
  usd: string;
  address: string;
  bip21: string;
  requiredSats: string;
  paidSats: string;
  expiresAt: string;
  orderId: string | null;
  returnUrl: string | null;
  payments: Array<{ txid: string; sats: string }>;
  convert: Array<{ txid: string; pusd: string }>;
}

export type StatusLine =
  | 'open'
  | 'converting'
  | 'paid'
  | 'underpaid'
  | 'underpaidLate'
  | 'overpaid'
  | 'expired'
  | 'paid_late';

export const bch = (sats: bigint): string => formatUnits(sats, 8);

const msLeft = (v: InvoiceView, now: number): number => Date.parse(v.expiresAt) - now;

/** The sentence that says where the invoice stands, and its values. */
export function statusLine(v: InvoiceView, now: number): { line: StatusLine; vars: Record<string, string> } {
  const required = BigInt(v.requiredSats);
  const paid = BigInt(v.paidSats);
  const amounts = { paid: bch(paid), required: bch(required) };
  const pusd = v.convert.reduce((sum, c) => sum + Number(c.pusd), 0);
  const converted = v.convert.length > 0;
  switch (v.status) {
    case 'open':
      return { line: 'open', vars: {} };
    case 'expired':
      return { line: 'expired', vars: {} };
    case 'paid_late':
      return { line: 'paid_late', vars: {} };
    case 'underpaid': {
      const rest = required > paid ? required - paid : 0n;
      return msLeft(v, now) > 0 ? { line: 'underpaid', vars: { ...amounts, rest: bch(rest) } } : { line: 'underpaidLate', vars: amounts };
    }
    case 'paid':
      return converted ? { line: 'paid', vars: { pusd: pusd.toFixed(2) } } : { line: 'converting', vars: {} };
    case 'overpaid':
      return converted ? { line: 'overpaid', vars: amounts } : { line: 'converting', vars: {} };
  }
}

/** True while a payment to the address can still count. */
export const payable = (v: InvoiceView, now: number): boolean => (v.status === 'open' || v.status === 'underpaid') && msLeft(v, now) > 0;

/** BCH still to send: the whole amount, or the rest of an underpaid invoice. */
export const dueSats = (v: InvoiceView): bigint => {
  const rest = BigInt(v.requiredSats) - BigInt(v.paidSats);
  return rest > 0n ? rest : 0n;
};

/** "mm:ss" (or "h:mm:ss") left, never below zero. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

export const isDemo = (v: InvoiceView): boolean => v.orderId?.startsWith(DEMO_ORDER_PREFIX) ?? false;

/** Ask the server again: a payment can still come, a convert is still awaited, or the demo order is not handed over. */
export function keepAsking(v: InvoiceView, now: number, demoFulfilled: boolean | null): boolean {
  if (payable(v, now)) return true;
  const paidish = v.status === 'paid' || v.status === 'overpaid' || v.status === 'paid_late';
  if (paidish && v.convert.length === 0) return true;
  return paidish && isDemo(v) && demoFulfilled === false;
}
