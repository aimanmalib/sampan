import { hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { poolV0ExchangeUnlocking, poolV0LockingBytecode, poolV0OwnerOf } from './pools/template.js';
import { formatUnits, parseUnits, splitPath, toWizardInputPaths } from './wallet.js';

describe('amounts', () => {
  it('parses plain decimals and refuses everything else', () => {
    expect(parseUnits('0.001', 8)).toBe(100_000n);
    expect(parseUnits('1', 2)).toBe(100n);
    expect(parseUnits('.5', 2)).toBe(50n);
    expect(parseUnits('1,25', 2)).toBe(125n);
    for (const bad of ['', '.', '-1', '1e3', '0.001', 'abc', '1.2.3']) expect(parseUnits(bad, 2), bad).toBeUndefined();
  });
  it('formats without trailing zeros unless asked', () => {
    expect(formatUnits(100_000n, 8)).toBe('0.001');
    expect(formatUnits(10_000n, 2, 2)).toBe('100.00');
    expect(formatUnits(2_000_000n, 8)).toBe('0.02');
    expect(formatUnits(0n, 8)).toBe('0');
  });
});

describe('paths', () => {
  it('maps server paths to hdwalletv1 input paths', () => {
    expect(splitPath('change/12')).toEqual(['change', 12]);
    expect(() => splitPath('stealth/1')).toThrow();
    expect(toWizardInputPaths([{ inputIndex: 2, path: 'receive/3' }])).toEqual([[2, 'receive', 3]]);
  });
});

describe('poolV0OwnerOf', () => {
  const pkh = hexToBin('11'.repeat(20));
  it('finds the owner of a genuine exchange spend', () => {
    expect(poolV0OwnerOf(poolV0ExchangeUnlocking(pkh), poolV0LockingBytecode(pkh))).toBe('11'.repeat(20));
  });
  it('refuses a look-alike: other locking script, altered unlocking, or nothing', () => {
    const other = hexToBin('22'.repeat(20));
    expect(poolV0OwnerOf(poolV0ExchangeUnlocking(pkh), poolV0LockingBytecode(other))).toBeUndefined();
    const altered = Uint8Array.from([...poolV0ExchangeUnlocking(pkh)]);
    altered[altered.length - 1] = altered.at(-1)! ^ 1;
    expect(poolV0OwnerOf(altered, poolV0LockingBytecode(pkh))).toBeUndefined();
    expect(poolV0OwnerOf(new Uint8Array(0), poolV0LockingBytecode(pkh))).toBeUndefined();
  });
});
