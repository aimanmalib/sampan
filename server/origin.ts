// Which crossings are the team's own. The counter on the page says how many were made by other people, so rows made
// from a team wallet are moved to `test`, including rows written before that wallet was listed.
import { parseAddress, type CashPrefix } from '../core/address.js';
import { normalTxid } from '../core/proof.js';
import type { Db } from './db.js';

/** Locking bytecodes (hex) of the listed addresses; addresses that do not parse are skipped. */
export function testLocksOf(addresses: string[], prefix: CashPrefix): Set<string> {
  return new Set(
    addresses.flatMap((a) => {
      const p = parseAddress(a, prefix);
      return typeof p === 'string' ? [] : [p.lockingHex];
    }),
  );
}

/**
 * Moves public rows to `test` when the user address is a team wallet, or when the row's txid is one of the team's own
 * measured runs (`teamTxids`, lower case without 0x: phone wallets pay from new addresses). Returns how many moved.
 */
export function markOwnRows(db: Db, testLocks: Set<string>, prefix: CashPrefix, teamTxids: Set<string> = new Set()): number {
  let moved = 0;
  for (const row of db.publicCrossings()) {
    const p = parseAddress(row.address, prefix);
    const teamTx = row.txid !== null && teamTxids.has(normalTxid(row.txid));
    if (teamTx || (typeof p !== 'string' && testLocks.has(p.lockingHex))) {
      db.setOrigin(row.id, 'test');
      moved += 1;
    }
  }
  return moved;
}
