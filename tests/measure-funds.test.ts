// The read-only balance tool behind docs/OPERATIONS.md "Test wallet funds": gap-limit walk, totals and table rows.
import { describe, expect, it } from 'vitest';
import { fundsLine, fundsRows, sumCoins, walkPath, type AddressLookup } from '../tools/measure/funds-scan.js';

const CAT = 'AB'.repeat(32);
const empty: AddressLookup = { used: false, coins: [] };

describe('walkPath', () => {
  it('stops after the gap of unused addresses and keeps coins found after a used address', async () => {
    const book: Record<number, AddressLookup> = { 0: { used: true, coins: [] }, 3: { used: true, coins: [{ sats: 5n }] } };
    const out = await walkPath(async (i) => book[i] ?? empty, 4);
    expect(out.coins).toEqual([{ sats: 5n }]);
    expect(out.looked).toBe(8); // 0..3, then 4 unused: 4, 5, 6, 7
  });

  it('counts an address holding coins as used even when the history count says otherwise', async () => {
    const out = await walkPath(async (i) => (i === 2 ? { used: false, coins: [{ sats: 1n }] } : empty), 3);
    expect(out.looked).toBe(6);
    expect(out.coins).toHaveLength(1);
  });
});

describe('sumCoins', () => {
  it('keeps plain satoshis apart from the satoshis under token outputs and adds tokens by category', () => {
    const t = sumCoins([{ sats: 1000n }, { sats: 800n, token: { category: CAT, amount: 150n } }, { sats: 800n, token: { category: CAT.toLowerCase(), amount: 50n } }]);
    expect(t.plainSats).toBe(1000n);
    expect(t.tokenSats).toBe(1600n);
    expect(t.tokens.get(CAT.toLowerCase())).toBe(200n);
  });
});

describe('fundsRows', () => {
  const base = {
    utc: '2026-01-02 03:04',
    bchWallet: 'bitcoincash:qtest',
    evmWallet: '0xTEST',
    totals: sumCoins([{ sats: 123_456_789n }, { sats: 800n, token: { category: CAT, amount: 205n } }]),
    tokens: [
      { symbol: 'AAA', category: CAT, decimals: 2 },
      { symbol: 'BBB', category: 'CD'.repeat(32), decimals: 2 },
    ],
    eth: 1_500_000_000_000_000n,
    evmTokens: [{ symbol: 'USDX', units: 2_500_000n, decimals: 6 }],
    needed: (asset: string) => ({ needed: asset === 'BCH' ? '0.01 BCH' : '0', why: 'w' }),
  };

  it('writes one row per asset with decimals from config, zero for a token the wallet does not hold', () => {
    const lines = fundsRows(base).map(fundsLine);
    expect(lines).toEqual([
      '| 2026-01-02 03:04 | `bitcoincash:qtest` | BCH | 1.23456789 BCH (123456789 sats) | 0.01 BCH | w |',
      '| 2026-01-02 03:04 | `bitcoincash:qtest` | AAA | 2.05 AAA | 0 | w |',
      '| 2026-01-02 03:04 | `bitcoincash:qtest` | BBB | 0.00 BBB | 0 | w |',
      '| 2026-01-02 03:04 | `0xTEST` | ETH (Base) | 0.0015 ETH | 0 | w |',
      '| 2026-01-02 03:04 | `0xTEST` | USDX (Base) | 2.50 USDX | 0 | w |',
    ]);
  });

  it('says "not read" instead of a zero when the RPC did not answer', () => {
    const rows = fundsRows({ ...base, eth: undefined, evmTokens: [{ symbol: 'USDX', units: undefined, decimals: 6 }] });
    expect(rows.slice(-2).map((r) => r.balance)).toEqual(['not read', 'not read']);
  });
});
