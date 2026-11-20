// Cash address <-> locking bytecode, shared by the server and the page. Pure.
import { binToHex, cashAddressToLockingBytecode, decodeCashAddress, encodeCashAddress, lockingBytecodeToCashAddress, hexToBin } from '@bitauth/libauth';

export type CashPrefix = 'bitcoincash' | 'bchtest';

export interface ParsedAddress {
  lockingHex: string;
  /** True for token-aware addresses (z..., r...), which wallets show for receiving CashTokens. */
  tokenAware: boolean;
}

/** Returns the locking bytecode of a cash address with the expected prefix, or a reason it is not usable. */
export function parseAddress(address: string, prefix: CashPrefix): ParsedAddress | string {
  const full = address.includes(':') ? address.trim().toLowerCase() : `${prefix}:${address.trim().toLowerCase()}`;
  if (!full.startsWith(`${prefix}:`)) return `address must start with ${prefix}:`;
  const decoded = decodeCashAddress(full);
  if (typeof decoded === 'string') return 'not a valid cash address';
  const lock = cashAddressToLockingBytecode(full);
  if (typeof lock === 'string') return 'not a valid cash address';
  return { lockingHex: binToHex(lock.bytecode), tokenAware: decoded.type === 'p2pkhWithTokens' || decoded.type === 'p2shWithTokens' };
}

/** Token-aware address for a locking bytecode (used when an output carries tokens). */
export function tokenAddressOf(lockingHex: string, prefix: CashPrefix): string {
  const res = lockingBytecodeToCashAddress({ bytecode: hexToBin(lockingHex), prefix, tokenSupport: true });
  if (typeof res === 'string') throw new Error(res);
  return res.address;
}

/**
 * The plain (q..., p...) form of a cash address: same key or script, without the token-aware type. Services that
 * only take plain addresses (1Click refuses z...) get this; the coins land at the same place. Other input unchanged.
 */
export function plainAddress(address: string): string {
  const decoded = decodeCashAddress(address.trim().toLowerCase());
  if (typeof decoded === 'string') return address;
  const type = decoded.type === 'p2pkhWithTokens' ? 'p2pkh' : decoded.type === 'p2shWithTokens' ? 'p2sh' : undefined;
  return type ? encodeCashAddress({ prefix: decoded.prefix, type, payload: decoded.payload }).address : address;
}
