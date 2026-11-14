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

  it('keep the event name exact in both languages', () => {
    expect(en['banner.event']).toBe('BCH BLAZE 2026');
    expect(ms['banner.event']).toBe('BCH BLAZE 2026');
  });
});
