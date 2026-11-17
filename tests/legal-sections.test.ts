import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateConfig, type SampanConfig } from '../core/config.js';
import { shownSections, type LegalFlags } from '../web/src/legal/sections.js';

const shipped = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as SampanConfig;
const en = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8')) as Record<string, string>;
const clone = () => structuredClone(shipped);

function flags(oneClick: boolean, cross: boolean): LegalFlags {
  return {
    features: { ...shipped.features, oneClick },
    route: { active: 'thorchain', symbols: cross ? ['USDC'] : [] },
    compliance: { crossChainEnabled: cross },
    legal: shipped.legal,
  };
}

describe('/terms and /risks sections for the 1Click route', () => {
  it('leave out the 1Click sections while features.oneClick is off, whatever the cross-chain state', () => {
    for (const cross of [false, true]) {
      for (const kind of ['terms', 'risks'] as const) {
        expect(shownSections(flags(false, cross), kind).map((s) => s.key)).not.toContain('oneclick');
      }
    }
  });

  it('show them while features.oneClick is on', () => {
    for (const kind of ['terms', 'risks'] as const) expect(shownSections(flags(true, true), kind).map((s) => s.key)).toContain('oneclick');
  });

  it('keep the cross rule for the other sections', () => {
    expect(shownSections(flags(true, false), 'risks').map((s) => s.key)).not.toContain('approval');
    expect(shownSections(flags(false, true), 'risks').map((s) => s.key)).toContain('approval');
  });

  it('carry the three UK sentences of the provider terms word for word in English', () => {
    const section = shipped.legal.terms.find((s) => s.key === 'oneclick');
    expect(section?.oneClick).toBe(true);
    const uk = en[`terms.oneclick.${section?.verbatim}`];
    for (const words of [
      'the Services are provided as a tool for End-Users to interact with the Protocol on their own initiative, with no endorsement or recommendation of cryptocurrency trading activities',
      'Intents Technology is not recommending that End-Users or potential End-Users engage in cryptoasset trading activity',
      'End-Users should not regard the Services as involving any form of recommendation, invitation, or inducement to deal in cryptoassets',
    ]) {
      expect(uk?.toLowerCase()).toContain(words.toLowerCase());
    }
  });

  it('name the operator chosen for the route', () => {
    expect(shipped.legal.operator).toContain('Sasa Teguh');
  });
});

describe('config check of legal sections', () => {
  it('accepts the shipped sections', () => {
    expect(validateConfig(clone()).filter((e) => e.startsWith('legal'))).toEqual([]);
  });

  it('rejects a flag that is not boolean, a repeated or badly named list item, and a bad verbatim part', () => {
    const c = clone();
    c.legal.terms = [
      { key: 'final', oneClick: 'yes' as unknown as boolean },
      { key: 'costs', list: ['a', 'a'] },
      { key: 'wallet', list: [] },
      { key: 'data', verbatim: 'bad-part' },
    ];
    const errors = validateConfig(c).join('\n');
    expect(errors).toMatch(/legal section final: oneClick/);
    expect(errors).toMatch(/legal section costs: list/);
    expect(errors).toMatch(/legal section wallet: list/);
    expect(errors).toMatch(/legal section data: verbatim/);
  });
});
