import { describe, expect, it } from 'vitest';
import { knownLang, pickLang } from '../web/src/lang-pick.js';

const files = ['en', 'ms'];
const both = { default: 'en', languages: [{ code: 'en', name: 'English' }, { code: 'ms', name: 'Bahasa Melayu' }] };

describe('language choice', () => {
  it('treats a code with no lang file, or nothing, as English', () => {
    expect(knownLang('ms', files)).toBe('ms');
    expect(knownLang('xx', files)).toBe('en');
    expect(knownLang(null, files)).toBe('en');
    expect(knownLang('constructor', files)).toBe('en');
  });

  it('keeps a stored choice config offers, else the config default, else English', () => {
    expect(pickLang(both, 'ms', files)).toBe('ms');
    expect(pickLang({ ...both, default: 'ms' }, null, files)).toBe('ms');
    expect(pickLang({ ...both, default: 'ms' }, 'xx', files)).toBe('ms');
    // A file config does not list is not shown, and a listed code with no file falls through to English.
    expect(pickLang({ default: 'en', languages: [{ code: 'en', name: 'English' }] }, 'ms', files)).toBe('en');
    expect(pickLang({ default: 'id', languages: [{ code: 'en', name: 'English' }, { code: 'id', name: 'Bahasa Indonesia' }] }, null, files)).toBe('en');
  });
});
