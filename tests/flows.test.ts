import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { descriptionKey, flowCombo, heroSubKey, openFlows, openTabs, symbolList, type OpenFlows } from '../core/flows.js';

const load = (name: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../lang/${name}.json`, import.meta.url), 'utf8')) as Record<string, string>;
const langs = { en: load('en'), ms: load('ms') };

// Words that only a text promising that flow would use, per language.
const MARKERS: Record<keyof typeof langs, Record<keyof OpenFlows, RegExp>> = {
  en: { swap: /\bSwap\b/, land: /landing|\bland BCH\b|BCH from any wallet/i, cross: /\{symbols\}/ },
  ms: { swap: /\bTukar\b/, land: /pendaratan|daratkan|BCH dari mana-mana/i, cross: /\{symbols\}/ },
};

const ALL: OpenFlows[] = [false, true].flatMap((swap) =>
  [false, true].flatMap((land) => [false, true].map((cross) => ({ swap, land, cross }))),
);

const flags = (over: { swap?: boolean; landing?: boolean; cross?: boolean; active?: string; symbols?: string[] }) => ({
  features: { swap: over.swap ?? false, landing: over.landing ?? false },
  route: { active: over.active ?? 'thorchain', symbols: over.symbols ?? ['USDC'] },
  compliance: { crossChainEnabled: over.cross ?? false },
});

describe('flows', () => {
  it('maps every flag combination to its own combo name', () => {
    expect(new Set(ALL.map(flowCombo)).size).toBe(8);
    expect(flowCombo({ swap: false, land: false, cross: false })).toBe('none');
    expect(flowCombo({ swap: true, land: false, cross: true })).toBe('swap-cross');
  });

  it('opens a crossing only with the compliance flag, an active route and at least one asset', () => {
    expect(openFlows(flags({ cross: true })).cross).toBe(true);
    expect(openFlows(flags({ cross: false })).cross).toBe(false);
    expect(openFlows(flags({ cross: true, active: 'none' })).cross).toBe(false);
    expect(openFlows(flags({ cross: true, symbols: [] })).cross).toBe(false);
    expect(openFlows(null)).toEqual({ swap: false, land: false, cross: false });
  });

  it('lists only tabs whose flow is open', () => {
    expect(openTabs({ swap: true, land: false, cross: false })).toEqual(['swap']);
    expect(openTabs({ swap: false, land: true, cross: false })).toEqual(['in']);
    expect(openTabs({ swap: true, land: true, cross: true })).toEqual(['swap', 'out', 'in']);
    expect(openTabs({ swap: false, land: false, cross: false })).toEqual([]);
  });

  for (const [lang, dict] of Object.entries(langs) as [keyof typeof langs, Record<string, string>][]) {
    it(`${lang}: hero and description text for each combination mention only the open flows`, () => {
      for (const f of ALL) {
        for (const key of [heroSubKey(f), descriptionKey(f)]) {
          const text = dict[key];
          expect(text, key).toBeTruthy();
          for (const flow of ['swap', 'land', 'cross'] as const) {
            expect(MARKERS[lang][flow].test(text!), `${key} ${flow}`).toBe(f[flow]);
          }
        }
      }
    });
  }

  it('no text promises USDT or fee-free crossings, and assets come only from route.symbols', () => {
    for (const dict of Object.values(langs)) {
      for (const [key, text] of Object.entries(dict)) {
        expect(text, key).not.toMatch(/USDT|USDC|No BCH needed|Tidak perlu BCH/i);
      }
    }
  });

  it('joins assets with the language word for "and"', () => {
    expect(symbolList(['USDC'], 'and')).toBe('USDC');
    expect(symbolList(['USDC', 'EURC'], 'dan')).toBe('USDC dan EURC');
    expect(symbolList(['A', 'B', 'C'], 'and')).toBe('A, B and C');
  });
});
