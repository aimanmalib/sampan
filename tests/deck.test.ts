// The event deck (tools/deck): template order, every number backed by a source, no claim words, nothing loaded from
// the network, and the committed PDF fits the banner link (ADR 0070).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { slides, slidesHash, TEMPLATE_TITLES, type Slide } from '../tools/deck/content.js';
import { deckHtml } from '../tools/deck/html.js';
import { END, START } from '../scripts/business-model.js';
import { measuredHeadline } from '../scripts/measured-json.js';
import { pitchFrom } from '../core/pitch.js';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const config = JSON.parse(read('config/sampan.json')) as {
  site: { url: string };
  banner: { deckUrl: string; repoUrl: string; tokenAddress: string };
};
const en = JSON.parse(read('lang/en.json')) as Record<string, string>;
const headline = measuredHeadline();
const pitch = pitchFrom(en, headline);
const facts = { siteUrl: config.site.url, repoUrl: config.banner.repoUrl, tokenAddress: config.banner.tokenAddress, pitch };
const deck = slides(facts);
const text = (s: Slide): string => [s.title, s.lead ?? '', ...(s.points ?? []), ...(s.foot ?? [])].join('\n');
const all = deck.map(text).join('\n');

/** Numbers in prose: hex ids, addresses and URLs are removed first; thousands separators dropped. */
function numbers(s: string): string[] {
  const prose = s
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b(bitcoincash|bchtest):[a-z0-9]+/g, ' ')
    .replace(/\b[0-9a-f]{64}\b/g, ' ')
    .replace(/\b[\w.-]+\.(md|cash|ts|com)\b/g, ' ');
  return [...prose.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ''));
}

function corpus(): Set<string> {
  const readme = read('README.md');
  const block = readme.slice(readme.indexOf(START), readme.indexOf(END));
  // The pitch's proof counts (crossings, chains, transactions) are counted from MEASURED by the bounty-table counter.
  const counted = [headline.crossings, headline.chains.length, headline.txids].map(String);
  return new Set([...numbers([read('docs/MEASURED.md'), read('config/sampan.json'), block].join('\n')), ...counted]);
}

describe('event deck', () => {
  it('opens with the front page pitch: the same lang keys, the proof counted from MEASURED (K6P4)', () => {
    expect(deck[0]!.lead).toBe(en['pitch.what']);
    expect(deck[0]!.points).toEqual([pitch.why, pitch.proof]);
    expect(pitch.proof).toContain(String(headline.txids));
  });

  it('keeps the eight template slides in order', () => {
    expect(deck.map((s) => s.title)).toEqual([...TEMPLATE_TITLES]);
  });

  it('names only numbers found in MEASURED, config or the business-model block', () => {
    const known = corpus();
    const unknown = numbers(all).filter((n) => !known.has(n));
    expect(unknown).toEqual([]);
  });

  it('a number that no source holds is caught', () => {
    const known = corpus();
    expect(numbers('Landing address: median 9.87 s').filter((n) => !known.has(n))).toEqual(['9.87']);
  });

  it('names only transaction ids that are rows of MEASURED', () => {
    const measured = read('docs/MEASURED.md');
    const ids = all.match(/\b[0-9a-f]{64}\b/g) ?? [];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => !measured.includes(id))).toEqual([]);
  });

  it('uses none of the words the public text rules forbid', () => {
    const banned =
      /\b(first|only|seamless|instant|trustless|guarantee[sd]?|safe|secure|legal|compliant|partners?|powered by|bridge|exchange|binance|endorsed)\b|!|\u2014/i;
    expect(all.match(banned)).toBeNull();
  });

  it('carries the site, the repository and the CashTokens address on the last slide', () => {
    const last = text(deck[deck.length - 1]!);
    expect(last).toContain(facts.siteUrl);
    expect(last).toContain(facts.repoUrl);
    expect(last).toContain(facts.tokenAddress);
  });

  it('lays out with no network reference except links', () => {
    const html = deckHtml(deck, { theme: 'paper', themeCss: '', fontCss: '', logoSvg: '<svg></svg>' });
    expect(html).not.toMatch(/(src|srcset)=["']https?:/);
    expect(html).not.toMatch(/url\(['"]?https?:/);
    expect(html.match(/<section class="slide/g)).toHaveLength(8);
    expect(html).toContain(`<a href="${facts.repoUrl}">`);
  });

  it('calls a measured iPhone 13 run what it was: WebKit set up as one, wallet approvals not timed', () => {
    const lines = all.split('\n').filter((l) => l.includes('iPhone 13'));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((l) => !l.includes('WebKit set up as an iPhone 13'))).toEqual([]);
    expect(all).not.toMatch(/on a desktop\b/);
    expect(lines.filter((l) => l.includes('wallet approvals') && !l.includes('not timed'))).toEqual([]);
  });

  it('the committed PDF was printed from the current slide text (rebuild with npm run deck)', () => {
    expect(read('tools/deck/printed.sha256').trim()).toBe(slidesHash(deck));
  });

  it('a slide text change makes the printed fingerprint stale', () => {
    const changed = deck.map((s, i) => (i === 3 ? { ...s, lead: `${s.lead ?? ''}.` } : s));
    expect(slidesHash(changed)).not.toBe(read('tools/deck/printed.sha256').trim());
  });

  it('the committed PDF is the banner deck: a PDF of eight pages under 3 MB', () => {
    expect(config.banner.deckUrl).toBe('/deck/sampan-blaze-2026.pdf');
    const pdf = readFileSync(new URL('../web/public/deck/sampan-blaze-2026.pdf', import.meta.url));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)).toHaveLength(8);
  });
});
