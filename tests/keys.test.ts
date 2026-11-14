import { describe, expect, it } from 'vitest';
import { deriveBchKey, evmAddress, isValidBip39Phrase, isValidEvmKey, newBip39Phrase } from '../core/keys.js';

// Public BIP39 test vector phrase; never funded by this project.
const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('test wallet key derivation', () => {
  it('derives the known BIP44 coin-145 address for the public test vector', () => {
    expect(deriveBchKey(VECTOR, 'mainnet').address).toBe('bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6');
  });

  it('uses the chipnet prefix and a token-aware twin with the same payload', () => {
    const main = deriveBchKey(VECTOR, 'mainnet');
    const chip = deriveBchKey(VECTOR, 'chipnet');
    expect(chip.address.startsWith('bchtest:q')).toBe(true);
    expect(main.tokenAddress.startsWith('bitcoincash:z')).toBe(true);
    expect(main.publicKey).toEqual(chip.publicKey);
  });

  it('rejects a phrase with a bad checksum', () => {
    const bad = VECTOR.replace(/about$/, 'abandon');
    expect(isValidBip39Phrase(bad)).toBe(false);
    expect(() => deriveBchKey(bad, 'mainnet')).toThrow();
  });

  it('generates fresh valid 12 word phrases', () => {
    const a = newBip39Phrase();
    expect(a.split(' ')).toHaveLength(12);
    expect(isValidBip39Phrase(a)).toBe(true);
    expect(newBip39Phrase()).not.toBe(a);
  });

  it('derives the known EVM address for private key 1', () => {
    expect(evmAddress(`0x${'0'.repeat(63)}1`)).toBe('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
    expect(isValidEvmKey('0x1234')).toBe(false);
  });
});
