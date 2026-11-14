// Cauldron pool v0 locking script, rebuilt from the pool owner's public key hash.
// Pure: no I/O. The script bytes follow the published pool v0 template (cashlab cauldron template,
// script id `cauldron_poolv0`, P2SH32). A pool reported by an indexer is only used when this rebuild
// hashes to the locking bytecode of its live UTXO.
import { binToHex, encodeDataPush, encodeLockingBytecodeP2sh32, hash256, hexToBin } from '@bitauth/libauth';

/** OP_DEPTH OP_IF OP_DUP OP_HASH160 */
const PREFIX = hexToBin('746376a9');

/**
 * Everything after the owner hash: withdraw branch (EQUALVERIFY CHECKSIG), then the exchange branch
 * (same token category and bytecode on the output at the same index, tx version 2, and
 * K_after_fee >= K_before with fee = |bch_out - bch_in| * 3 / 1000).
 */
const SUFFIX = hexToBin('88ac67c0d1c0ce88c25288c0cdc0c788c0c6c0d095c0c6c0cc9490539502e80396c0cc7c94c0d3957ca268');

export const POOL_V0_FEE_NUMERATOR = 3n;
export const POOL_V0_FEE_DENOMINATOR = 1000n;

export const poolV0RedeemScript = (ownerPkh: Uint8Array): Uint8Array => {
  if (ownerPkh.length !== 20) throw new Error('pool owner hash must be 20 bytes');
  return Uint8Array.from([...PREFIX, ...encodeDataPush(ownerPkh), ...SUFFIX]);
};

export const poolV0LockingBytecode = (ownerPkh: Uint8Array): Uint8Array =>
  encodeLockingBytecodeP2sh32(hash256(poolV0RedeemScript(ownerPkh)));

/** Unlocking bytecode for the exchange path: a single push of the redeem script. */
export const poolV0ExchangeUnlocking = (ownerPkh: Uint8Array): Uint8Array =>
  encodeDataPush(poolV0RedeemScript(ownerPkh));

export const poolV0LockingHex = (ownerPkhHex: string): string => binToHex(poolV0LockingBytecode(hexToBin(ownerPkhHex)));

/**
 * Owner hash (hex) of a pool input spent through the exchange path, or undefined when the input is anything
 * else. The unlocking bytecode must be exactly the exchange unlocking of that owner and the spent locking
 * bytecode must be the pool built from it, so a look-alike script never passes.
 */
export const poolV0OwnerOf = (unlocking: Uint8Array, locking: Uint8Array): string | undefined => {
  const start = unlocking.length - SUFFIX.length - 20;
  if (start < 0) return undefined;
  const pkh = unlocking.slice(start, start + 20);
  const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same(unlocking, poolV0ExchangeUnlocking(pkh)) || !same(locking, poolV0LockingBytecode(pkh))) return undefined;
  return binToHex(pkh);
};
