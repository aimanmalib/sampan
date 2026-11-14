// Frozen capture of real Cauldron PUSD pools plus a throwaway signing key for building test swaps.
import { readFileSync } from 'node:fs';
import { encodeLockingBytecodeP2pkh, hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import type { PoolUtxo } from '../../core/pools/trade.js';
import type { UserCoin } from '../../core/tx/types.js';

interface IndexerPool {
  owner_p2pkh_addr: string;
  owner_pkh: string;
  sats: number;
  tokens: number;
  tx_pos: number;
  txid: string;
}

export const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/cauldron-pusd-pools.json', import.meta.url), 'utf8'),
) as { category: string; active: IndexerPool[] };

export const PUSD = fixture.category;

export const pools: PoolUtxo[] = fixture.active.map((p) => ({
  txid: p.txid,
  vout: p.tx_pos,
  sats: BigInt(p.sats),
  tokens: BigInt(p.tokens),
  category: PUSD,
  ownerPkh: p.owner_pkh,
}));

/** Deterministic key used only inside tests; it has never held funds. */
export const testKey = sha256.hash(utf8ToBin('sampan unit test key, never funded'));
const publicKey = secp256k1.derivePublicKeyCompressed(testKey) as Uint8Array;
export const userLock = encodeLockingBytecodeP2pkh(hash160(publicKey));
export const otherKey = sha256.hash(utf8ToBin('sampan unit test key two, never funded'));
export const otherLock = encodeLockingBytecodeP2pkh(hash160(secp256k1.derivePublicKeyCompressed(otherKey) as Uint8Array));

export const coin = (vout: number, sats: bigint, tokens?: bigint): UserCoin => ({
  txid: 'ab'.repeat(32),
  vout,
  sats,
  lockingBytecode: userLock,
  ...(tokens === undefined ? {} : { token: { category: PUSD, amount: tokens } }),
});
