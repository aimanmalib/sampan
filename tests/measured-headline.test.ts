import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { headlineParts, type Headline } from '../core/client/measured.js';
import { countStats, load, repoFile, type BountyConfig } from '../scripts/bounty-table.js';
import { measuredHeadline } from '../scripts/measured-json.js';

// The front page "Measured" headline is counted when the page is built, by the counter of the README bounty table.
const h = (c: string): string => c.repeat(64);
const cfg: BountyConfig = {
  tokens: { PUSD: {}, MUSD: {} },
  connect: { explorerTxUrl: 'https://bch.example/tx/{txid}' },
  evm: { chains: [
    { key: 'ETH', name: 'Ethereum', explorer: 'https://eth.example' },
    { key: 'BSC', name: 'BNB Smart Chain', explorer: 'https://bsc.example' },
  ] },
  oneClick: { assets: [{ live: { out: false, in: false } }] },
};
const runs = [
  `| 2026-11-15T12:38:16Z | swap | 0.001 BCH to at least 0.19 MUSD | ${h('1')} | 1.4 | ok |`,
  `| 2026-11-17T11:00:00Z | g3a | 2 ETH.USDC to PUSD (landing address) | bch ${h('2')} · eth 0x${h('3')} | 2021.1 | ok |`,
  `| 2026-11-17T12:03:34Z | out | 1.8 PUSD to ETH.USDC | bch ${h('a')} · eth 0x${h('b')} | 373.7 | ok |`,
  `| 2026-11-18T04:00:00Z | out | 2 PUSD to BSC.USDT | - | 12.0 | fail (route refused) |`,
  `| 2026-11-18T05:00:00Z | oc-out | 2 PUSD to BSC.USDT | bch ${h('f')} · bsc 0x${h('0')} | 80.0 | ok |`,
  `| 2026-11-18T06:00:00Z | out | 0.01 BCH to BSC.USDT | bch ${h('c')} · bsc 0x${h('d')} | 90.0 | ok |`,
];
const measured = (rows: string[]): string => ['# Measured', '', '## Runs', '', '| UTC | flow | amount | txid | seconds | result |',
  '|---|---|---|---|---|---|', ...rows, ''].join('\n');

const en = JSON.parse(readFileSync(repoFile('lang/en.json'), 'utf8')) as Record<string, string>;
const headlineFor = (c: BountyConfig, text: string): Headline => {
  const { crossings, chains, symbols, bothWays, txids } = countStats(c, text);
  return { crossings, chains, symbols, bothWays, txids };
};
const renderHeadline = (head: Headline): string =>
  headlineParts(head, (key, vars = {}) => (en[key] ?? '').replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? ''), (xs) => xs.join(', ')).join(' · ');

/** The crossing count written independently of the counter: ok rows of Runs in the THORChain flows (and 1Click flows when live). */
function okRowsByHand(c: BountyConfig, text: string): number {
  const flows = new Set(['out', 'in', 'g3a']);
  const oc = c.oneClick?.assets ?? [];
  if (oc.some((a) => a.live?.out)) flows.add('oc-out');
  if (oc.some((a) => a.live?.in)) flows.add('oc-in');
  const section = text.split('## Runs')[1]?.split('\n## ')[0] ?? '';
  return section.split('\n').filter((line) => {
    const x = line.trim().replace(/^\||\|$/g, '').split('|').map((y) => y.trim());
    return x.length >= 6 && flows.has(x[1] ?? '') && (x.at(-1) ?? '').toLowerCase() === 'ok';
  }).length;
}

describe('Measured headline', () => {
  it('the built headline is the bounty counter on the real docs/MEASURED.md and config', () => {
    const { cfg: live, measured: real } = load();
    const s = countStats(live, real);
    const built = measuredHeadline();
    expect(built).toEqual({ crossings: s.crossings, chains: s.chains, symbols: s.symbols, bothWays: s.bothWays, txids: s.txids });
    expect(built.crossings).toBe(okRowsByHand(live, readFileSync(repoFile('docs/MEASURED.md'), 'utf8')));
    expect(built.crossings).toBeGreaterThan(0);
  });

  it('counts ok crossings, chains, symbols and transaction ids; a chain measured one way is not "both ways"', () => {
    const head = headlineFor(cfg, measured(runs));
    expect(head).toEqual({ crossings: 3, chains: ['Ethereum', 'BNB Smart Chain'], symbols: ['USDC', 'USDT'], bothWays: ['Ethereum'], txids: 6 });
    expect(renderHeadline(head)).toBe(
      '3 stablecoin crossings on mainnet, on 2 chains (Ethereum, BNB Smart Chain), in USDC, USDT · both ways on Ethereum · 6 mainnet transactions',
    );
  });

  it('mutant: one more ok crossing in Runs adds one', () => {
    const more = [...runs, `| 2026-11-18T07:00:00Z | in | 1.6 BSC.USDT to PUSD | bch ${h('9')} · bsc 0x${h('8')} | 48.4 | ok |`];
    const head = headlineFor(cfg, measured(more));
    expect(head.crossings).toBe(4);
    expect(head.crossings).toBe(okRowsByHand(cfg, measured(more)));
    expect(head.bothWays).toEqual(['Ethereum', 'BNB Smart Chain']);
    expect(head.txids).toBe(8);
  });

  it('leaves "both ways" out while no chain is measured each way', () => {
    const oneWay: Headline = headlineFor(cfg, measured([runs[2] ?? '']));
    expect(oneWay.bothWays).toEqual([]);
    expect(renderHeadline(oneWay)).not.toContain('both ways');
  });

  it('every language has the headline texts with the same placeholders as English', () => {
    for (const lang of ['en', 'ms', 'id', 'fil']) {
      const d = JSON.parse(readFileSync(repoFile(`lang/${lang}.json`), 'utf8')) as Record<string, string>;
      for (const key of ['measured.headline', 'measured.bothWays', 'measured.txids', 'measured.see', 'measured.server']) {
        const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
        expect(d[key]?.trim(), `${lang} ${key}`).toBeTruthy();
        expect(vars(d[key] ?? ''), `${lang} ${key}`).toEqual(vars(en[key] ?? ''));
      }
    }
  });
});
