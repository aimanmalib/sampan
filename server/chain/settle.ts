// A Fulcrum server answers a broadcast before its own index lists the new outputs; a rescan in that gap reads
// the old coins and caches them. Wait until the index shows the transaction (or the time runs out).
import { binToHex, type Transaction } from '@bitauth/libauth';
import type { Chain } from './types.js';

const OP_RETURN = 0x6a;

/** True once the index lists an output of `txid`; false when `waitMs` passed first. */
export async function waitIndexed(chain: Chain, txid: string, tx: Transaction, o: { waitMs: number; pollMs: number }): Promise<boolean> {
  const vout = tx.outputs.findIndex((out) => out.lockingBytecode[0] !== OP_RETURN && out.valueSatoshis > 0n);
  if (vout < 0) return true;
  const lock = binToHex(tx.outputs[vout]!.lockingBytecode);
  const until = Date.now() + o.waitMs;
  for (;;) {
    const utxos = await chain.listUnspent(lock).catch(() => []);
    if (utxos.some((u) => u.txid === txid && u.vout === vout)) return true;
    if (Date.now() + o.pollMs > until) return false;
    await new Promise((r) => setTimeout(r, o.pollMs));
  }
}
