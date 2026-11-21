// The review before signing (features.reviewModal, K5P8): the lines it lists, the fingerprint that tells a moved price
// from an unchanged one, and the flag in config.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateConfig, type SampanConfig } from '../core/config.js';
import type { CostCard } from '../core/cost.js';
import { crossRows, fingerprint, shortAddress, swapRows } from '../web/src/review/rows.js';

const shipped = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as SampanConfig;
const en = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8')) as Record<string, string>;
const t = (key: string, vars: Record<string, string> = {}): string => en[key]!.replace(/\{(\w+)\}/g, (_m, name: string) => vars[name] ?? `{${name}}`);
const card = (over: Partial<CostCard> = {}): CostCard => ({
  payUsd: 2_000_000n,
  receiveUsd: 1_700_000n,
  totalUsd: 300_000n,
  leftoverUsd: 0n,
  keepPct: 85,
  parts: [],
  impactBps: 10,
  minutes: { from: 2, to: 6 },
  expiresAt: 0,
  warn: { impact: false, cost: false },
  ...over,
});
const out = { pay: '2.00 PUSD', about: '1.70', min: '1.60', asset: 'USDC', route: 'THORChain', to: '0x1a87…94Cb' };

describe('review rows', () => {
  it('Swap on BCH: pay, receive, cost, route and the connected wallet, in that order', () => {
    const rows = swapRows(t, { pay: '0.001 BCH', about: '0.42', min: '0.41', asset: 'PUSD', poolPct: '0.3', feeCap: '0.00002' });
    expect(rows.map((r) => r.key)).toEqual(['pay', 'receive', 'cost', 'route', 'to']);
    expect(rows[1]!.value).toBe('about 0.42 PUSD, at least 0.41 PUSD');
    expect(rows[4]!.value).toBe(t('review.toWallet'));
  });

  it('Send out: the cost card gives the share kept, the total cost and the time', () => {
    const rows = crossRows(t, { ...out, card: card() });
    expect(rows.map((r) => r.key)).toEqual(['pay', 'receive', 'keep', 'cost', 'route', 'time', 'to']);
    expect(Object.fromEntries(rows.map((r) => [r.key, r.value]))).toMatchObject({ keep: '85.0%', cost: 'USD 0.30', time: 'Arrives in about 2 to 6 min', to: '0x1a87…94Cb' });
    expect(crossRows(t, { ...out, card: card({ minutes: { from: 3 } }) }).find((r) => r.key === 'time')!.value).toBe('Arrives in about 3 min');
  });

  it('without a cost card no number is made up: no keep, cost or time line', () => {
    expect(crossRows(t, { ...out, card: null }).map((r) => r.key)).toEqual(['pay', 'receive', 'route', 'to']);
  });

  it('Bring in as a stablecoin says the landing address changes the BCH', () => {
    const rows = crossRows(t, { ...out, asset: 'BCH', thenToken: 'PUSD', card: null });
    expect(rows[1]!.value).toBe('about 1.70 BCH, at least 1.60 BCH Your landing address then changes it to PUSD.');
  });

  it('the fingerprint changes with any number and stays put for the same numbers', () => {
    const a = crossRows(t, { ...out, card: card() });
    expect(fingerprint(crossRows(t, { ...out, card: card() }))).toBe(fingerprint(a));
    expect(fingerprint(crossRows(t, { ...out, min: '1.59', card: card() }))).not.toBe(fingerprint(a));
    expect(fingerprint(crossRows(t, { ...out, card: card({ keepPct: 84.9 }) }))).not.toBe(fingerprint(a));
  });

  it('shortAddress keeps short values whole', () => {
    expect(shortAddress('0x1a877169bB03400fA69EC4813889E78994D194Cb')).toBe('0x1a87…94Cb');
    expect(shortAddress('abc')).toBe('abc');
  });
});

describe('features.reviewModal', () => {
  it('is a boolean in the shipped config and required', () => {
    expect(typeof shipped.features.reviewModal).toBe('boolean');
    const features: Record<string, unknown> = { ...shipped.features };
    delete features.reviewModal;
    expect(validateConfig({ ...shipped, features } as unknown as SampanConfig)).toContain('features.reviewModal: true or false');
  });

  it('every review line has its label in every language', () => {
    for (const lang of shipped.i18n.languages.map((l: { code: string }) => l.code)) {
      const text = JSON.parse(readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      for (const key of ['pay', 'receive', 'keep', 'cost', 'route', 'time', 'to', 'updated', 'accept', 'confirm', 'cancel']) expect(text[`review.${key}`], `${lang} review.${key}`).toBeTruthy();
    }
  });
});
