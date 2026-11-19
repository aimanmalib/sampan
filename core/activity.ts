// "My activity" and "find a transaction" (ADR 0076). Pure helpers shared by the server and the page: the limits in
// config `activity`, the one shape a pasted transaction id must have, and the address forms a crossing row is matched
// by. The page sends only the addresses of the wallets it has connected; the server never lists anyone else's.

export interface ActivityConfig {
  /** Most addresses one request may ask about (a scanned BCH wallet plus one EVM address). */
  maxAddresses: number;
  /** Most crossings returned, newest first. */
  maxRows: number;
}

export function validateActivity(a: ActivityConfig | undefined): string[] {
  const int = (v: unknown, lo: number, hi: number): boolean => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  const errors: string[] = [];
  if (!int(a?.maxAddresses, 1, 500)) errors.push('activity.maxAddresses: an integer from 1 to 500');
  if (!int(a?.maxRows, 1, 200)) errors.push('activity.maxRows: an integer from 1 to 200');
  return errors;
}

/** A full transaction id: 64 hex digits, with or without 0x. Returns it bare and lower case, or null. */
export function bareTxid(input: string): string | null {
  const t = input.trim().replace(/^0x/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(t) ? t : null;
}

/**
 * The one form an address is matched by: EVM addresses in lower case (rows keep the case the wallet gave), CashAddr
 * without its prefix (the server compares stored rows the same way). Anything else gives null and matches nothing.
 */
export function addressKey(address: string): string | null {
  const a = address.trim().toLowerCase();
  if (/^0x[0-9a-f]{40}$/.test(a)) return a;
  const m = /^(?:[a-z]+:)?([02-9ac-hj-np-z]{42,112})$/.exec(a);
  return m ? m[1]! : null;
}

/** One crossing as POST /api/activity returns it. */
export interface ActivityRow {
  id: string;
  kind: 'swap' | 'land' | 'out' | 'in';
  status: string;
  asset: string;
  chain: string | null;
  amount: string;
  createdAt: number;
  url: string;
}

/**
 * What the page says about a row. A crossing out or in keeps its last known status: the server writes "broadcast" or
 * "sent" when the deposit goes out and the final answer (completed, refunded, failed) only when the route is asked,
 * which the status page does. So a sent crossing out or in reads "sent" (open it for the status), never "done" by itself.
 * A crossing out or in marked failed may have failed after its deposit went out (the route said so), so it reads
 * "unfinished" (open it for the status), never "not sent".
 */
export type ActivityState = 'done' | 'refunded' | 'failed' | 'open' | 'sent' | 'unfinished';

type Kind = ActivityRow['kind'];

/**
 * Every status the server writes, per kind (server/api/swap, out, in, broadcast, crossings and the landing watcher).
 * null: built or planned but never signed, so not a crossing yet and not listed.
 */
export const ACTIVITY_STATES: Record<Kind, Record<string, ActivityState | null>> = {
  swap: { built: null, broadcast: 'done', stale: 'failed', failed: 'failed' },
  land: { open: 'open', seen: 'open', converted: 'done', returned: 'refunded' },
  out: { built: null, broadcast: 'sent', stale: 'failed', failed: 'unfinished', completed: 'done', refunded: 'refunded' },
  in: { planned: null, sent: 'sent', completed: 'done', refunded: 'refunded', failed: 'unfinished' },
};

/** The word for a row, or null for one never signed. A status not in the table reads "sent": open it for the status. */
export function activityState(kind: Kind, status: string): ActivityState | null {
  const known = ACTIVITY_STATES[kind];
  return known && Object.hasOwn(known, status) ? (known[status] ?? null) : 'sent';
}

/** The (kind, status) pairs that were never signed: the server leaves them out of the list. */
export const UNSIGNED: ReadonlyArray<readonly [Kind, string]> = (Object.keys(ACTIVITY_STATES) as Kind[]).flatMap((k) =>
  Object.entries(ACTIVITY_STATES[k])
    .filter(([, v]) => v === null)
    .map(([st]) => [k, st] as const),
);

/**
 * The addresses the page asks about: every address the BCH wallet scan derived (plain and token form) and the
 * connected EVM address, each once, no more than `max`.
 */
export function activityAddresses(derived: ReadonlyArray<{ address: string; tokenAddress: string }>, evm: string | null, max: number): string[] {
  const all = [...(evm ? [evm] : []), ...derived.flatMap((d) => [d.address, d.tokenAddress])];
  return [...new Set(all)].slice(0, max);
}
