import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (name: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../lang/${name}.json`, import.meta.url), 'utf8')) as Record<string, string>;

describe('lang files', () => {
  const en = load('en');
  const ms = load('ms');

  it('have the same keys', () => {
    expect(Object.keys(ms).sort()).toEqual(Object.keys(en).sort());
  });

  it('have no empty strings and the same placeholders per key', () => {
    for (const key of Object.keys(en)) {
      expect(en[key]?.trim(), key).not.toBe('');
      expect(ms[key]?.trim(), key).not.toBe('');
      const vars = (s: string | undefined): string[] => (s?.match(/\{\w+\}/g) ?? []).sort();
      expect(vars(ms[key]), key).toEqual(vars(en[key]));
    }
  });

  it('have the text of every /terms and /risks section listed in config, with no word the terms page must avoid', () => {
    const config = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as {
      legal: Record<'terms' | 'risks', { key: string }[]>;
    };
    const avoid = /\b(legal|compliant|licensed|regulated|guaranteed?|safe|secure|trustless|instant|seamless)\b/i;
    for (const kind of ['terms', 'risks'] as const) {
      const parts = kind === 'risks' ? ['title', 'text', 'funds'] : ['title', 'text'];
      for (const { key } of config.legal[kind]) {
        for (const part of parts) {
          const id = `${kind}.${key}.${part}`;
          expect(en[id], id).toBeTruthy();
          expect(ms[id], id).toBeTruthy();
          expect(en[id], id).not.toMatch(avoid);
        }
      }
    }
  });

  it('say on /risks, in both languages, that an arrival below the dust amount from config cannot be given back', () => {
    const config = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as {
      landing: { dustSats: number };
      legal: { risks: { key: string }[] };
    };
    expect(config.landing.dustSats).toBeGreaterThan(0);
    const shown = config.legal.risks.filter((r) => !('cross' in r)).map((r) => `risks.${r.key}.funds`);
    for (const lang of [en, ms]) {
      expect(shown.some((id) => lang[id]?.includes('{dust}'))).toBe(true);
    }
  });

  it('keep the event name exact in both languages', () => {
    expect(en['banner.event']).toBe('BCH BLAZE 2026');
    expect(ms['banner.event']).toBe('BCH BLAZE 2026');
  });

  it('claim no exchange or bursa sending to a landing address, a path that was never tested', () => {
    // Only the terms may name an exchange, to say what Sampan is not.
    for (const [lang, text] of [['en', en], ['ms', ms]] as const) {
      for (const [key, value] of Object.entries(text)) {
        if (key.startsWith('terms.')) continue;
        expect(value, `${lang} ${key}`).not.toMatch(/\bexchanges?\b|\bbursa\b|binance/i);
      }
    }
  });
});
