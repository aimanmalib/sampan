// The words for docs/route-facts.json (core/route-facts-text.ts) on a frozen fixture, the README block made from them
// (scripts/route-facts-table.ts), and README.md / README.ms.md holding exactly the block the generator makes now.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Fee, RouteFact, RouteFacts } from '../core/route-facts.js';
import { duration, feeCell, feeText, fullLabel, lineLabel, lineParts, quotedAt, routeName, shortLabel, shortParts, signaturesText, timeCell } from '../core/route-facts-text.js';
import { currentBlock, END, factsBlock, load, replaceBlock, START, TARGETS, textOf, type Dictionary } from '../scripts/route-facts-table.js';

const en = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8')) as Dictionary;
const ms = JSON.parse(readFileSync(new URL('../lang/ms.json', import.meta.url), 'utf8')) as Dictionary;
// A frozen dictionary for the wording checks, so a lang edit does not turn these red; the README check uses the real files.
const DICT: Dictionary = {
  'tabs.swap': 'Swap', 'land.source': 'Landing', 'tabs.out': 'Out', 'tabs.in': 'In', 'route.thorchain': 'TC', 'route.near-intents': 'NI',
  'facts.title': 'T', 'facts.lead': 'L {at}', 'facts.easier': 'E', 'facts.col.route': 'R', 'facts.col.time': 'Ti', 'facts.col.signatures': 'S',
  'facts.col.fee': 'F {at}', 'facts.route': '{flow}: {chain} via {route}', 'facts.seconds': '{n} s', 'facts.minutes': '{n} min',
  'facts.time': 'about {time}', 'facts.runs': 'about {time}, {n} runs', 'facts.runsOne': 'about {time}, 1 run', 'facts.range': '({min} to {max})',
  'facts.notTimed': 'untimed', 'facts.sig.one': '1 sig', 'facts.sig.many': '{n} sigs', 'facts.payment': 'one payment',
  'facts.fee': 'fee {usd} at {at} ({pct}\u00a0%)', 'facts.feeShort': 'fee {usd} at {at}', 'facts.plusNetwork': 'plus network', 'facts.noQuote': 'no quote',
  'facts.measured': 'measured over {n} runs', 'facts.measuredOne': 'measured over 1 run', 'facts.quoted': 'fee quoted {at}',
  'facts.quotedAt': 'quoted {at}', 'facts.measuredShort': 'measured', 'facts.shortBoth': 'time measured, fee quoted', 'facts.quotedShort': 'fee quoted',
};
const t = textOf(DICT, DICT);
const fee = (usd: number, pct: number, network: 'included' | 'excluded' = 'included', at = '2026-11-20T23:17:24.572Z'): Fee =>
  ({ usd, pct, impact_usd: 0, quoted_at: at, network });
const NONE: Fee = { usd: null, reason: 'route closed' };

const SWAP: RouteFact = {
  id: 'swap', label: 'tabs.swap', flow: 'swap', route: null, chain: null, symbols: [],
  time: { median_s: 3, n: 22, min_s: 1.4, max_s: 4.4, rows: ['a'] }, signatures: 1, payments: 0,
  fees: { '2': fee(0.01, 0.35), '20': fee(0.06, 0.31), '100': fee(0.31, 0.31, 'included', '2026-11-20T23:17:30.000Z') },
};
const LAND: RouteFact = { ...SWAP, id: 'land', label: 'land.source', flow: 'land', signatures: 0, payments: 1, fees: { '2': fee(0.01, 0.37, 'excluded'), '20': fee(0.06, 0.31, 'excluded'), '100': NONE } };
const OUT: RouteFact = {
  id: 'out:thorchain:ETH', label: 'tabs.out', flow: 'out', route: 'thorchain', chain: 'ETH', symbols: ['USDC'],
  time: { median_s: 466.6, n: 3, min_s: 373.7, max_s: 1104, rows: ['b', 'c', 'd'] }, signatures: 2, payments: 0,
  fees: { '2': fee(0.26, 13.13), '20': fee(0.35, 1.77, 'included', '2026-11-20T23:16:59.000Z'), '100': fee(0.76, 0.76) },
};
const IN: RouteFact = { ...OUT, id: 'in:near-intents:BASE', label: 'tabs.in', flow: 'in', route: 'near-intents', chain: 'BASE', time: null, signatures: 1, fees: { '2': NONE, '20': NONE, '100': NONE } };
const FACTS: RouteFacts = { generated_at: '2026-11-20T23:17:49.681Z', signatures_counted_at: '2026-11-20T23:14:08.185Z', routes: [SWAP, LAND, OUT, IN] };
const CFG = { evm: { chains: [{ key: 'ETH', name: 'Ethereum' }, { key: 'BASE', name: 'Base' }] } };
const chainName = (k: string): string => CFG.evm.chains.find((c) => c.key === k)!.name;

describe('route facts words', () => {
  it('says seconds under two minutes and minutes from there', () => {
    expect([0.2, 3, 107.4, 119.6, 120, 466.6, 3360].map((s) => duration(s, t))).toEqual(['1 s', '3 s', '107 s', '120 s', '2 min', '8 min', '56 min']);
  });

  it('writes the hero line from the time, the signatures and the fee at USD 20', () => {
    expect(lineParts(OUT, t)).toEqual(['about 8 min, 3 runs', '2 sigs', 'fee $0.35 at $20 (1.8\u00a0%)']);
    expect(lineLabel(OUT, t)).toBe('quoted 2026-11-20 23:16 UTC');
    expect(fullLabel(OUT, t)).toBe('measured over 3 runs · fee quoted 2026-11-20 23:16 UTC');
    expect(lineParts(SWAP, t)).toEqual(['about 3 s, 22 runs', '1 sig', 'fee $0.06 at $20 (0.31\u00a0%)']);
  });

  it('never puts "measured" after a quoted fee, and says the fee was quoted on the short line too', () => {
    const line = `${lineParts(OUT, t).join(' · ')} ${lineLabel(OUT, t)}`;
    expect(line).toMatch(/fee \$0\.35 at \$20 \(1\.8\u00a0%\) quoted 2026-11-20 23:16 UTC$/);
    expect(line.slice(line.indexOf('fee $'))).not.toMatch(/measured/);
    expect(shortParts(SWAP, t)).toEqual(['about 3 s', '1 sig', 'fee $0.06 at $20']);
    expect(shortLabel(SWAP, t)).toBe('time measured, fee quoted');
    expect(shortLabel({ ...SWAP, time: null }, t)).toBe('fee quoted');
    expect(shortLabel({ ...OUT, fees: IN.fees }, t)).toBe('measured');
    expect(lineLabel({ ...OUT, fees: IN.fees }, t)).toBe('measured');
  });

  it('names a landing by its one payment and marks a fee without the payer\'s network fee', () => {
    expect(signaturesText(LAND, t)).toBe('one payment');
    expect(feeText(LAND.fees['20'], '20', t)).toBe('fee $0.06 at $20 (0.31\u00a0%) plus network');
    expect(feeCell(LAND.fees['100'], t)).toBe('no quote');
  });

  it('leaves out what was not measured or quoted instead of guessing', () => {
    expect(lineParts(IN, t)).toEqual(['1 sig']);
    expect(lineLabel(IN, t)).toBe('');
    expect(shortLabel(IN, t)).toBe('');
    expect(timeCell(IN, t)).toBe('untimed');
  });

  it('writes the table time with runs and range, and one run without a range', () => {
    expect(timeCell(OUT, t)).toBe('about 8 min, 3 runs (6 min to 18 min)');
    expect(timeCell({ ...OUT, time: { median_s: 50, n: 1, min_s: 50, max_s: 50, rows: ['x'] } }, t)).toBe('about 50 s, 1 run');
  });

  it('names a crossing by flow, chain and route', () => {
    expect(routeName(OUT, t, chainName)).toBe('Out: Ethereum via TC');
    expect(routeName(IN, t, chainName)).toBe('In: Base via NI');
    expect(routeName(SWAP, t, chainName)).toBe('Swap');
  });

  it('dates the table by the earliest quote', () => {
    expect(quotedAt(FACTS)).toBe('2026-11-20T23:16:59.000Z');
    expect(quotedAt({ ...FACTS, routes: [IN] })).toBeNull();
  });
});

describe('README route facts block', () => {
  it('writes one row per route between the markers, from the facts and the lang words', () => {
    const block = factsBlock(FACTS, CFG, t);
    expect(block.startsWith(START) && block.endsWith(END)).toBe(true);
    expect(block).toContain('| Out: Ethereum via TC | about 8 min, 3 runs (6 min to 18 min) | 2 sigs | $0.26 (13.1\u00a0%) | $0.35 (1.8\u00a0%) | $0.76 (0.76\u00a0%) |');
    expect(block).toContain('| In: Base via NI | untimed | 1 sig | no quote | no quote | no quote |');
    expect(block).toContain('L 2026-11-20 23:16 UTC');
    // Mutant: one more measured run must change the block, so a README that kept the old row goes red.
    const more = { ...FACTS, routes: [SWAP, LAND, { ...OUT, time: { ...OUT.time!, n: 4 } }, IN] };
    expect(factsBlock(more, CFG, t)).not.toBe(block);
  });

  it('replaces only the block', () => {
    const text = `a\n${START}\nold\n${END}\nb`;
    expect(replaceBlock(text, `${START}\nnew\n${END}`)).toBe(`a\n${START}\nnew\n${END}\nb`);
    expect(() => replaceBlock('no markers', 'x')).toThrow(/markers/);
  });

  it('has the same keys in English and Malay for every word it uses', () => {
    const used = Object.keys(DICT).filter((k) => k.startsWith('facts.'));
    for (const k of used) {
      expect(en[k], k).toBeTypeOf('string');
      expect(ms[k], k).toBeTypeOf('string');
    }
  });

  it('README.md and README.ms.md hold the block made from docs/route-facts.json (run npm run route-facts -- --write)', () => {
    const { facts, cfg, text } = load();
    for (const target of TARGETS) {
      const readme = readFileSync(new URL(`../${target.path}`, import.meta.url), 'utf8');
      expect(currentBlock(readme), `${target.path}: run npm run route-facts -- --write`).toBe(factsBlock(facts, cfg, text(target.lang)));
    }
  });
});
