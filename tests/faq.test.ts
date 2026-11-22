// config.faq: question keys and custody steps are checked, and a `cross` step shows only while crossings are open.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FAQ_MIN_ITEMS, shownCustody, validateFaq, type FaqConfig } from '../core/faq.js';

const shipped = (JSON.parse(readFileSync('config/sampan.json', 'utf8')) as { faq: FaqConfig }).faq;
const langs = ['en', 'ms', 'id', 'fil'].map((code) => [code, JSON.parse(readFileSync(`lang/${code}.json`, 'utf8')) as Record<string, string>] as const);

describe('config.faq', () => {
  it('ships valid, with at least six questions', () => {
    expect(validateFaq(shipped)).toEqual([]);
    expect(shipped.items.length).toBeGreaterThanOrEqual(FAQ_MIN_ITEMS);
  });

  it('has a question, an answer and every custody step in each language', () => {
    for (const [code, dict] of langs) {
      for (const k of shipped.items) {
        expect(dict[`faq.${k}.q`], `${code} faq.${k}.q`).toBeTruthy();
        expect(dict[`faq.${k}.a`], `${code} faq.${k}.a`).toBeTruthy();
      }
      for (const s of shipped.custody) {
        expect(dict[`faq.hold.${s.key}.title`], `${code} ${s.key}`).toBeTruthy();
        expect(dict[`faq.hold.${s.key}.text`], `${code} ${s.key}`).toBeTruthy();
      }
    }
  });

  it('rejects too few, repeated or badly named questions and bad steps', () => {
    const base: FaqConfig = { items: ['a', 'b', 'c', 'd', 'e', 'f'], custody: [{ key: 'wallet' }] };
    expect(validateFaq(base)).toEqual([]);
    expect(validateFaq({ ...base, items: base.items.slice(1) }).join()).toMatch(/faq.items/);
    expect(validateFaq({ ...base, items: [...base.items.slice(1), 'b'] }).join()).toMatch(/faq.items/);
    expect(validateFaq({ ...base, items: [...base.items.slice(1), 'Bad-key'] }).join()).toMatch(/faq.items/);
    expect(validateFaq({ ...base, custody: [] }).join()).toMatch(/faq.custody/);
    expect(validateFaq({ ...base, custody: [{ key: 'w', cross: 'yes' as unknown as boolean }] }).join()).toMatch(/cross/);
    expect(validateFaq(undefined)).toHaveLength(2);
  });

  it('shows a cross step only while crossings are open', () => {
    const f: FaqConfig = { items: [], custody: [{ key: 'wallet' }, { key: 'route', cross: true }] };
    expect(shownCustody(f, true).map((s) => s.key)).toEqual(['wallet', 'route']);
    expect(shownCustody(f, false).map((s) => s.key)).toEqual(['wallet']);
  });
});
