import { describe, expect, it } from 'vitest';
import { gasUsd, refuseFunding } from '../tools/test-wallet/gas-fund.js';

const BUDGET = { maxUsdPerTx: 3, maxUsdPerDay: 12 };

describe('gas funding of the EVM test key', () => {
  it('values the gas coin at the pool price, rounded up to the cent', () => {
    // 0.0005 ETH at USD 1805.30154755 = USD 0.90265 -> 0.91
    expect(gasUsd(50_000n, 180_530_154_755n)).toBe(0.91);
    expect(gasUsd(0n, 180_530_154_755n)).toBe(0);
  });

  it('refuses above the funding cap, the per-transaction limit or the day', () => {
    expect(refuseFunding(0.95, 1.5, BUDGET, 0)).toBeUndefined();
    expect(refuseFunding(1.51, 1.5, BUDGET, 0)).toMatch(/funding cap/);
    expect(refuseFunding(1, 5, { ...BUDGET, maxUsdPerTx: 0.5 }, 0)).toMatch(/per-transaction/);
    expect(refuseFunding(1, 1.5, BUDGET, 11.5)).toMatch(/daily limit/);
    expect(refuseFunding(0, 1.5, BUDGET, 0)).toMatch(/no USD value/);
  });
});
