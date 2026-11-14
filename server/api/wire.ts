// JSON shapes on the wire. Amounts are decimal strings (never floats); bytes are lowercase hex.
import { binToHex, encodeTransaction, hexToBin, type Output } from '@bitauth/libauth';
import type { Tx } from '../../core/tx/types.js';
import type { ChainUtxo } from '../chain/types.js';

export interface WireOutput {
  lockingBytecode: string;
  valueSatoshis: string;
  token?: { category: string; amount: string };
}

export const outputToWire = (o: Output): WireOutput => ({
  lockingBytecode: binToHex(o.lockingBytecode),
  valueSatoshis: o.valueSatoshis.toString(),
  ...(o.token ? { token: { category: binToHex(o.token.category), amount: o.token.amount.toString() } } : {}),
});

export const outputFromWire = (w: WireOutput): Output => ({
  lockingBytecode: hexToBin(w.lockingBytecode),
  valueSatoshis: BigInt(w.valueSatoshis),
  ...(w.token ? { token: { category: hexToBin(w.token.category), amount: BigInt(w.token.amount) } } : {}),
});

export const txToHex = (tx: Tx): string => binToHex(encodeTransaction(tx));

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
