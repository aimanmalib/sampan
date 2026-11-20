// K6P4: the front page's main message in under a minute without the video. Three lang keys in every language the
// config offers, English at most 45 words, and the proof's numbers are the MEASURED headline counter's, never typed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PITCH_KEYS, pitchFrom, pitchWords } from '../core/pitch.js';
import type { Headline } from '../core/client/measured.js';
import { measuredHeadline } from '../scripts/measured-json.js';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const config = JSON.parse(read('config/sampan.json')) as { i18n: { languages: { code: string }[] } };
const langs = Object.fromEntries(
  config.i18n.languages.map((l) => [l.code, JSON.parse(read(`lang/${l.code}.json`)) as Record<string, string>]),
);
const fixture: Headline = { crossings: 9, chains: ['Ethereum', 'Base'], symbols: ['USDC'], bothWays: [], txids: 31 };

describe('pitch (K6P4)', () => {
  it('has the three keys, filled in, in every language the config offers', () => {
    for (const [code, text] of Object.entries(langs)) {
      for (const k of PITCH_KEYS) expect(text[k]?.trim(), `${code} ${k}`).toBeTruthy();
      expect(text['pitch.proof'], code).toMatch(/\{crossings\}.*\{chains\}.*\{txids\}/);
    }
  });

  it('reads in about 15 seconds in English: at most 45 words, a number counting as one', () => {
    expect(pitchWords(langs.en!)).toBeLessThanOrEqual(45);
    expect(pitchWords({ 'pitch.what': 'a b', 'pitch.why': 'c {n} d', 'pitch.proof': '' })).toBe(5);
  });

  it('takes the proof numbers from the headline it is given', () => {
    const p = pitchFrom(langs.en!, fixture);
    expect(p.proof).toContain('9');
    expect(p.proof).toContain('2');
    expect(p.proof).toContain('31');
    expect(p.proof).not.toMatch(/\{/);
    expect(pitchFrom(langs.en!, { ...fixture, txids: 32 }).proof).not.toBe(p.proof);
  });

  it('on the built page counts from docs/MEASURED.md with the bounty-table counter', () => {
    const h = measuredHeadline();
    expect(pitchFrom(langs.en!, h).proof).toContain(`${h.crossings} `);
    expect(pitchFrom(langs.en!, h).proof).toContain(`${h.txids} `);
  });
});
