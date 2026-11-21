// The header balance (features.headerBalance, K5P6): what it shows, and the config values it reads.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicConfig, validateConfig, type SampanConfig } from '../core/config.js';
import { balanceLines } from '../web/src/wallet/balance.js';

const shipped = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as SampanConfig;
const pusd = { symbol: 'PUSD', category: 'AB'.repeat(32), decimals: 2 };
const musd = { symbol: 'MUSD', category: 'CD'.repeat(32), decimals: 2 };

describe('balanceLines', () => {
  it('rounds BCH down to the configured digits and shows each token with its own decimals', () => {
    const view = { sats: 2_679_999n, tokens: { ['ab'.repeat(32)]: 160n } };
    expect(balanceLines(view, [pusd], 5)).toEqual([
      { amount: '0.02679', unit: 'BCH' },
      { amount: '1.60', unit: 'PUSD' },
    ]);
    expect(balanceLines(view, [pusd], 8)[0]).toEqual({ amount: '0.02679999', unit: 'BCH' });
  });

  it('shows 0 for an empty wallet and for a token it does not hold, one line per offered token', () => {
    const lines = balanceLines({ sats: 0n, tokens: {} }, [pusd, musd], 5);
    expect(lines).toEqual([
      { amount: '0', unit: 'BCH' },
      { amount: '0.00', unit: 'PUSD' },
      { amount: '0.00', unit: 'MUSD' },
    ]);
  });
});

describe('wallet.balancePollMs and wallet.balanceBchDecimals', () => {
  const withWallet = (w: Partial<SampanConfig['wallet']>): SampanConfig => ({ ...shipped, wallet: { ...shipped.wallet, ...w } });

  it('reach the page from the shipped config', () => {
    expect(validateConfig(shipped)).toEqual([]);
    expect(publicConfig(shipped).balance).toEqual({ pollMs: shipped.wallet.balancePollMs, bchDecimals: shipped.wallet.balanceBchDecimals });
    expect(typeof shipped.features.headerBalance).toBe('boolean');
  });

  it.each([1, 4999, 600001, 30000.5, undefined])('rejects balancePollMs = %s', (v) => {
    expect(validateConfig(withWallet({ balancePollMs: v as number }))).toContain('wallet.balancePollMs: 0 or an integer from 5000 to 600000');
  });

  it.each([1, 9, 4.5, undefined])('rejects balanceBchDecimals = %s', (v) => {
    expect(validateConfig(withWallet({ balanceBchDecimals: v as number }))).toContain('wallet.balanceBchDecimals: an integer from 2 to 8');
  });

  it('accepts 0 (after transactions only) and both ends of each range', () => {
    for (const w of [{ balancePollMs: 0, balanceBchDecimals: 2 }, { balancePollMs: 5000, balanceBchDecimals: 8 }, { balancePollMs: 600000 }]) {
      expect(validateConfig(withWallet(w))).toEqual([]);
    }
  });

  it('rejects a missing flag', () => {
    const features: Partial<SampanConfig['features']> = { ...shipped.features };
    delete features.headerBalance;
    expect(validateConfig({ ...shipped, features } as unknown as SampanConfig)).toContain('features.headerBalance: true or false');
  });
});
