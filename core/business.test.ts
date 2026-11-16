import { describe, expect, it } from 'vitest';
import { feeLockingHex, sampanFeeSats, validateBusiness, type BusinessConfig } from './business.js';

// Fixture addresses (not the shipped config): a P2PKH, its token-aware form and a P2SH.
const P2PKH = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const ok: BusinessConfig = { feeBps: 0, feeAddress: P2PKH, scenarioBps: 30, scenarioShares: [0.01, 0.05], sources: [] };

describe('sampanFeeSats', () => {
  it('is feeBps of the BCH side, rounded down', () => {
    expect(sampanFeeSats(200_000n, 30)).toBe(600n);
    expect(sampanFeeSats(1_234_567n, 30)).toBe(3703n);
  });
  it('is 0 when the fee is off or would be dust', () => {
    expect(sampanFeeSats(1_000_000n, 0)).toBe(0n);
    expect(sampanFeeSats(100_000n, 30)).toBe(0n);
    expect(sampanFeeSats(182_000n, 30)).toBe(546n);
  });
});

describe('business config', () => {
  it('accepts a P2PKH fee address and refuses a P2SH one, a bad address and an out-of-range fee', () => {
    expect(validateBusiness(ok)).toEqual([]);
    expect(validateBusiness({ ...ok, feeAddress: 'bitcoincash:pplrydnf2z4pj4z9rv7uhmwsuxyrm8hj7ugknpcwg7' }).join()).toMatch(/feeAddress/);
    expect(validateBusiness({ ...ok, feeAddress: 'bitcoincash:nothing' }).join()).toMatch(/feeAddress/);
    expect(validateBusiness({ ...ok, feeBps: 501 }).join()).toMatch(/feeBps/);
    expect(validateBusiness({ ...ok, feeBps: 1.5 }).join()).toMatch(/feeBps/);
    expect(validateBusiness({ ...ok, scenarioShares: [0, 2] }).join()).toMatch(/scenarioShares/);
    expect(validateBusiness({ ...ok, sources: [{ key: 'a', label: 'a', value: 1, unit: 'USD', url: 'http://x', read: '2026-11-16' }] }).join()).toMatch(/sources/);
    const src = { key: 'a', label: 'a', value: 1, unit: 'USD', url: 'https://x', read: '2026-11-16' };
    expect(validateBusiness({ ...ok, sources: [src, src] }).join()).toMatch(/key used twice/);
    expect(validateBusiness({ ...ok, sources: [{ ...src, value: 'n/a', scenario: true }] }).join()).toMatch(/number above 0/);
  });
  it('gives no fee lock while the fee is off and the P2PKH lock when it is on', () => {
    expect(feeLockingHex(ok, 'bitcoincash')).toBeUndefined();
    expect(feeLockingHex({ ...ok, feeBps: 30 }, 'bitcoincash')).toMatch(/^76a914[0-9a-f]{40}88ac$/);
    expect(() => feeLockingHex({ ...ok, feeBps: 30 }, 'bchtest')).toThrow(/feeAddress/);
  });
});
