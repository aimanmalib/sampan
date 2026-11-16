import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BusinessConfig, BusinessSource } from '../core/business.js';
import { README_FILE, businessModel, loadBusiness, replaceBlock, scenarioRows, START, END } from '../scripts/business-model.js';

// A frozen fixture, not the shipped config: the numbers in config/sampan.json are re-read and may change.
const flow: BusinessSource = { key: 'flow', label: 'Coins traded in a day', value: 1_000_000, unit: 'USD per day', url: 'https://example.org/flow', read: '2026-11-16', scenario: true };
const stock: BusinessSource = { key: 'stock', label: 'Coins locked', value: 500_000, unit: 'USD', url: 'https://example.org/stock', read: '2026-11-15' };
const fixture: BusinessConfig = {
  feeBps: 0,
  feeAddress: 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt',
  scenarioBps: 30,
  scenarioShares: [0.01, 0.1],
  sources: [flow, stock],
};

describe('business model', () => {
  it('multiplies the scenario source by each share and the fee', () => {
    const { source, rows } = scenarioRows(fixture);
    expect(source.key).toBe('flow');
    expect(rows.map((r) => r.perDayUsd)).toEqual([30, 300]);
    expect(rows.map((r) => r.perYearUsd)).toEqual([10_950, 109_500]);
  });

  it('prints every source with its URL and read date, and labels the scenario', () => {
    const md = businessModel(fixture);
    expect(md.startsWith(START) && md.endsWith(END)).toBe(true);
    expect(md).toContain('| Coins traded in a day | USD 1,000,000 per day | 2026-11-16 | https://example.org/flow |');
    expect(md).toContain('| Coins locked | USD 500,000 | 2026-11-15 | https://example.org/stock |');
    expect(md).toMatch(/arithmetic, not a forecast/);
    expect(md).toContain('| 10 % | USD 300 | USD 109,500 |');
  });

  it('refuses a source without a URL or read date, a lone source, and no scenario source', () => {
    expect(() => businessModel({ ...fixture, sources: [{ ...flow, url: '' }, stock] })).toThrow(/url and read date/);
    expect(() => businessModel({ ...fixture, sources: [flow, { ...stock, read: '' }] })).toThrow(/url and read date/);
    expect(() => businessModel({ ...fixture, sources: [flow] })).toThrow(/at least 2/);
    expect(() => businessModel({ ...fixture, sources: [{ ...flow, scenario: false }, stock] })).toThrow(/marked scenario/);
    expect(() => businessModel({ ...fixture, sources: [{ ...flow, value: 'many' }, stock] })).toThrow(/number above 0/);
  });

  it('replaces only the block between the markers', () => {
    const doc = `a\n${START}\nold\n${END}\nb`;
    expect(replaceBlock(doc, 'NEW')).toBe('a\nNEW\nb');
    expect(() => replaceBlock('no markers', 'x')).toThrow(/markers/);
  });

  it('README.md carries the block made from config/sampan.json (run the script with --write after a config change)', () => {
    const readme = readFileSync(README_FILE, 'utf8');
    expect(readme).toContain(businessModel(loadBusiness()));
  });
});
