// A route that names a crossing by its one-time deposit address (1Click) is asked by that address, and told when a
// deposit was sent. THORChain needs neither: its status is asked by txid and it reads deposits from the chain.
import type { CrossingRow } from '../db.js';
import type { Route } from '../routes/types.js';
import type { Services } from '../services.js';

/** The route a crossing row was built for; rows from before the route column fall back to the active route. */
export const routeOf = (s: Services, row: CrossingRow): Route | null => s.routes.find((r) => r.id === row.route) ?? s.route;

/** Out: the deposit address the BCH paid. In: the deposit address the EVM transfer paid (kept in the row's record). */
export function depositAddressOf(row: CrossingRow): string | undefined {
  if (row.kind === 'out') return row.deposit_address ?? undefined;
  if (row.kind !== 'in' || !row.quote_json) return undefined;
  const vault = (JSON.parse(row.quote_json) as { vault?: unknown }).vault;
  return typeof vault === 'string' && vault !== '' ? vault : undefined;
}

/** Tells the route about a sent deposit where it asks for it. Optional for the route: a failure is noted on the row only. */
export async function submitDeposit(s: Services, row: CrossingRow, txid: string): Promise<void> {
  const route = routeOf(s, row);
  const address = depositAddressOf(row);
  if (!route?.submit || !address) return;
  try {
    await route.submit(txid, address);
  } catch (e) {
    s.db.updateCrossing(row.id, { error: `submit: ${e instanceof Error ? e.message : 'failed'}`.slice(0, 500) });
  }
}
