import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (name: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../lang/${name}.json`, import.meta.url), 'utf8')) as Record<string, string>;

describe('lang files', () => {
  const en = load('en');
  // Every lang/*.json, whether config offers it yet or not: a language is either whole or absent.
  const codes = readdirSync(new URL('../lang/', import.meta.url))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
  const others = codes.filter((c) => c !== 'en');

  it('include English and Malay', () => {
    expect(codes).toEqual(expect.arrayContaining(['en', 'ms']));
  });

  it.each(others)('%s has exactly the English keys', (code) => {
    expect(Object.keys(load(code)).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(codes)('%s has no empty strings and the same placeholders as English per key', (code) => {
    const text = load(code);
    const vars = (s: string | undefined): string[] => (s?.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en)) {
      expect(typeof text[key], `${code} ${key}`).toBe('string');
      expect(text[key]?.trim(), `${code} ${key}`).not.toBe('');
      expect(vars(text[key]), `${code} ${key}`).toEqual(vars(en[key]));
    }
  });

  it('cover every language config offers', () => {
    const config = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as {
      i18n: { languages: { code: string }[] };
    };
    for (const { code } of config.i18n.languages) expect(codes, code).toContain(code);
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
          for (const code of codes) expect(load(code)[id], `${code} ${id}`).toBeTruthy();
          expect(en[id], id).not.toMatch(avoid);
        }
      }
    }
  });

  it('say on /risks, in every language, that an arrival below the dust amount from config cannot be given back', () => {
    const config = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as {
      landing: { dustSats: number };
      legal: { risks: { key: string }[] };
    };
    expect(config.landing.dustSats).toBeGreaterThan(0);
    const shown = config.legal.risks.filter((r) => !('cross' in r)).map((r) => `risks.${r.key}.funds`);
    for (const lang of codes.map(load)) {
      expect(shown.some((id) => lang[id]?.includes('{dust}'))).toBe(true);
    }
  });

  it('keep the event name exact in every language', () => {
    for (const code of codes) expect(load(code)['banner.event'], code).toBe('BCH BLAZE 2026');
  });

  it('claim no exchange or bursa sending to a landing address, a path that was never tested', () => {
    // Only the terms may name an exchange, to say what Sampan is not.
    for (const lang of codes) {
      for (const [key, value] of Object.entries(load(lang))) {
        if (key.startsWith('terms.')) continue;
        expect(value, `${lang} ${key}`).not.toMatch(/\bexchanges?\b|\bbursa\b|binance/i);
      }
    }
  });

  it('name each language in its own words and say a software translation is one, with English applying', () => {
    const config = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as {
      i18n: { languages: { code: string; name: string; machine?: boolean }[] };
    };
    for (const { code, name } of config.i18n.languages) expect(load(code)['lang.name'], code).toBe(name);
    for (const code of others) expect(load(code)['legal.translation'], code).not.toBe(en['legal.translation']);
  });
});
