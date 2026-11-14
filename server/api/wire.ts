// JSON shapes on the wire. Amounts are decimal strings (never floats); bytes are lowercase hex.
export { outputFromWire, outputToWire, txToHex, type WireOutput } from '../../core/wire.js';
import type { ChainUtxo } from '../chain/types.js';

export const utxoToWire = (u: ChainUtxo): Record<string, unknown> => ({
  txid: u.txid,
  vout: u.vout,
  sats: u.sats.toString(),
  height: u.height,
  ...(u.token ? { token: { category: u.token.category, amount: u.token.amount.toString(), nft: Boolean(u.token.nft) } } : {}),
});

/** Deep copy with every bigint turned into a decimal string. */
export const jsonSafe = (v: unknown): unknown =>
  typeof v === 'bigint'
    ? v.toString()
    : Array.isArray(v)
      ? v.map(jsonSafe)
      : v && typeof v === 'object' && !(v instanceof Uint8Array)
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]))
        : v;

export const AMOUNT = { type: 'string', pattern: '^[0-9]{1,20}$' } as const;
export const HEX_ID = { type: 'string', pattern: '^[0-9a-f]{32}$' } as const;
export const ADDRESS = { type: 'string', minLength: 20, maxLength: 120 } as const;
