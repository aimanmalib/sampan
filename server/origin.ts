// Which crossings are the team's own. The counter on the page says how many were made by other people, so rows made
// from a team wallet are moved to `test`, including rows written before that wallet was listed.
import { parseAddress, type CashPrefix } from '../core/address.js';
import { normalTxid } from '../core/proof.js';
import type { Db } from './db.js';

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;

/**
 * What a listed address is matched by: the locking bytecode (hex) of a cash address, whatever its form (a token-aware
 * `z…` address locks the same script as its `p…`/`q…` form), or an EVM address in lower case with its 0x (rows sent
 * out to Base store the destination). The two never collide: bytecode hex has no 0x. Anything else is skipped.
 */
export function ownKey(address: string, prefix: CashPrefix): string | null {
  const a = address.trim();
  if (EVM_ADDRESS.test(a)) return a.toLowerCase();
  const p = parseAddress(a, prefix);
  return typeof p === 'string' ? null : p.lockingHex;
}

/** Keys (see ownKey) of the listed team addresses; addresses that do not parse are skipped. */
export function testLocksOf(addresses: string[], prefix: CashPrefix): Set<string> {
  return new Set(addresses.flatMap((a) => ownKey(a, prefix) ?? []));
}

/**
 * Moves public rows to `test` when the user address is a team wallet, or when the row's txid is one of the team's own
 * measured runs (`teamTxids`, lower case without 0x: phone wallets pay from new addresses). Returns how many moved.
 */
export function markOwnRows(db: Db, testLocks: Set<string>, prefix: CashPrefix, teamTxids: Set<string> = new Set()): number {
  let moved = 0;
  for (const row of db.publicCrossings()) {
    const key = ownKey(row.address, prefix);
    const teamTx = row.txid !== null && teamTxids.has(normalTxid(row.txid));
    if (teamTx || (key !== null && testLocks.has(key))) {
      db.setOrigin(row.id, 'test');
      moved += 1;
    }
  }
  return moved;
}
