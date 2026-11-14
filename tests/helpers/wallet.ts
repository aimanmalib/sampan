// Addresses of the throwaway unit-test keys (tests/helpers/pools.ts), as the page would send them.
import { binToHex, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { otherLock, userLock } from './pools.js';

const addr = (lock: Uint8Array, tokenSupport: boolean): string => {
  const r = lockingBytecodeToCashAddress({ bytecode: lock, prefix: 'bitcoincash', tokenSupport });
  if (typeof r === 'string') throw new Error(r);
  return r.address;
};

export const userAddress = addr(userLock, false);
export const userTokenAddress = addr(userLock, true);
export const userLockHex = binToHex(userLock);
export const otherAddress = addr(otherLock, false);
export const otherLockHex = binToHex(otherLock);

/** `n` distinct never-used P2PKH addresses (hash160 = index bytes), for gap-limit tests. */
export const blankAddresses = (n: number, salt = 0): string[] =>
  Array.from({ length: n }, (_, i) => {
    const h = new Uint8Array(20);
    h[0] = salt;
    h[18] = (i >> 8) & 0xff;
    h[19] = i & 0xff;
    return addr(Uint8Array.from([0x76, 0xa9, 0x14, ...h, 0x88, 0xac]), false);
  });
