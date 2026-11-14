// JSON shapes shared by the server and the page. Amounts are decimal strings (never floats); bytes are lowercase hex.
import { binToHex, decodeTransaction, encodeTransaction, hexToBin, type Output } from '@bitauth/libauth';
import type { Expectation } from './check.js';
import type { Tx } from './tx/types.js';

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

export const txFromHex = (hex: string): Tx => {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') throw new Error(`transaction cannot be read: ${tx}`);
  return tx;
};

/** Expectation as sent by /api/swap/build (bigints as decimal strings). */
export interface WireExpectation {
  userLockingBytecodes: string[];
  inputPaths: Array<{ inputIndex: number; path: string }>;
  poolOwnerPkhs: string[];
  deposits?: Array<{ lockingBytecode: string; sats: string }>;
  opReturn?: string;
  spend: { sats: string; tokens: Record<string, string> };
  feeCapSats: string;
  receive: { category: string; min: string };
}

export const expectationFromWire = (w: WireExpectation): Expectation => ({
  userLockingBytecodes: w.userLockingBytecodes,
  inputPaths: w.inputPaths,
  poolOwnerPkhs: w.poolOwnerPkhs,
  ...(w.deposits ? { deposits: w.deposits.map((d) => ({ lockingBytecode: d.lockingBytecode, sats: BigInt(d.sats) })) } : {}),
  ...(w.opReturn !== undefined ? { opReturn: w.opReturn } : {}),
  spend: { sats: BigInt(w.spend.sats), tokens: Object.fromEntries(Object.entries(w.spend.tokens).map(([k, v]) => [k, BigInt(v)])) },
  feeCapSats: BigInt(w.feeCapSats),
  receive: { category: w.receive.category, min: BigInt(w.receive.min) },
});
