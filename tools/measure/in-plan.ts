// Pure parts of a measured Bring in (tools/measure/in-run.ts): the Runs label, and how the finished conversion of the
// landing address is read back from the server once the route has paid it.
import { formatUnits } from '../../core/wallet.js';

export function inLabel(p: { amount: bigint; symbol: string; chain: string; receive: string; landing: boolean }, minSats: bigint): string {
  const to = p.landing ? `${p.receive} (landing address, at least ${formatUnits(minSats, 8)} BCH arriving)` : `BCH (at least ${formatUnits(minSats, 8)} BCH)`;
  return `${formatUnits(p.amount, 8)} ${p.chain}.${p.symbol} to ${to}`;
}

/** The server's view of a landing crossing (GET /api/crossings/:id). */
export interface LandingView {
  status: string;
  txid?: string | null;
  landing?: { address: string | null; paymentTxid: string | null };
}

/**
 * The conversion txid once the server's finisher converted exactly the BCH the route paid (`bchTxid`) at the landing
 * address; undefined while it has not. A return (`returned`) or a conversion of another payment is not this crossing's.
 */
export function convertedTxid(view: LandingView, bchTxid: string): string | undefined {
  if (view.status !== 'converted' || !view.txid) return undefined;
  if (view.landing?.paymentTxid?.toLowerCase() !== bchTxid.toLowerCase()) return undefined;
  return view.txid.toLowerCase();
}
