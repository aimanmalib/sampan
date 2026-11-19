import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TARGETS, bountyBlock, countStats, currentBlock, load, repoFile, replaceBlock, rowStatus,
  type Bounty, type BountyConfig, type Row,
} from '../scripts/bounty-table.js';

// A frozen fixture, not the shipped config or MEASURED.md: those change with every run.
const cfg: BountyConfig = {
  tokens: { PUSD: {}, MUSD: {} },
  connect: { explorerTxUrl: 'https://bch.example/tx/{txid}' },
  evm: { chains: [
    { key: 'ETH', name: 'Ethereum', explorer: 'https://eth.example' },
    { key: 'BSC', name: 'BNB Smart Chain', explorer: 'https://bsc.example' },
  ] },
  oneClick: { assets: [{ live: { out: false, in: false } }] },
};
const h = (c: string): string => c.repeat(64);
const runs = [
  `| 2026-11-15T12:38:16Z | swap | 0.001 BCH to at least 0.19 MUSD | ${h('1')} | 1.4 | ok |`,
  `| 2026-11-17T11:00:00Z | g3a | 2 ETH.USDC to PUSD (landing address) | bch ${h('2')} · eth 0x${h('3')} | 2021.1 | ok |`,
  `| 2026-11-17T12:03:34Z | out | 1.8 PUSD to ETH.USDC | bch ${h('a')} · eth 0x${h('b')} | 373.7 | ok |`,
  `| 2026-11-18T04:00:00Z | out | 2 PUSD to BSC.USDT | - | 12.0 | fail (route refused) |`,
  `| 2026-11-18T05:00:00Z | oc-out | 2 PUSD to BSC.USDT | bch ${h('f')} · bsc 0x${h('0')} | 80.0 | ok |`,
  `| 2026-11-18T06:00:00Z | out | 0.01 BCH to BSC.USDT | bch ${h('c')} · bsc 0x${h('d')} | 90.0 | ok |`,
];
const measured = (rows: string[]): string => ['# Measured', '', '## Runs', '', '| UTC | flow | amount | txid | seconds | result |',
  '|---|---|---|---|---|---|', ...rows, '', '## Next', '| 2026-11-19T00:00:00Z | out | 1 PUSD to ETH.USDC | - | 1 | ok |'].join('\n');
const t = (en: string): { en: string; ms: string } => ({ en, ms: `ms ${en}` });
const bounty: Bounty = {
  source: 'https://bounty.example/', readUtc: '2026-11-19T14:24Z', bounty: 'Example',
  intro: t('From {source} on {readDate}, counted from {measured}.'),
  headline: t('{crossings} crossings on {chains} chains ({chainNames}) in {symbols}; both ways on {bothWays}.'),
  columns: { en: ['Requirement', 'Sampan', 'Proof'], ms: ['Syarat', 'Sampan', 'Bukti'] },
  statusLabels: { en: { met: 'Met', partly: 'Partly', open: 'Open' }, ms: { met: 'Dipenuhi', partly: 'Sebahagian', open: 'Belum' } },
  joinWord: { en: ' and ', ms: ' dan ' },
  rows: [
    { section: 'Requirements', quote: 'Go both ways, & out of BCH', rule: 'bothDirections', note: t('Both.'),
      proof: [{ kind: 'runs', ref: 'PUSD to ', flows: ['out'], label: t('out') }] },
    { section: 'Requirements', quote: 'Many chains', rule: 'chains', note: t('{chains}: {chainNames}.'),
      proof: [{ kind: 'file', ref: 'docs/MEASURED.md#runs', label: t('Runs') }] },
    { section: 'Stretch goals', quote: 'Many BCH stables', rule: 'bchStables', note: t('{bchStables}.'),
      proof: [{ kind: 'url', ref: 'https://bounty.example/', label: t('page') }] },
    { section: 'Stretch goals', quote: 'Talk to people', status: 'open', note: t('Not done.'),
      proof: [{ kind: 'file', ref: 'core/cost.ts', label: t('cost') }] },
  ],
};
const block = (rows = runs, path = 'README.md', lang: 'en' | 'ms' = 'en'): string => bountyBlock(bounty, cfg, measured(rows), { path, lang });

describe('bounty table', () => {
  it('counts ok crossings in the Runs section only, with the flows of the crossings table', () => {
    const s = countStats(cfg, measured(runs));
    expect(s.crossings).toBe(3);
    expect(s.chains).toEqual(['Ethereum', 'BNB Smart Chain']);
    expect(s.symbols).toEqual(['USDC', 'USDT']);
    expect(s.bothWays).toEqual(['Ethereum']);
    expect(s.bchStables).toEqual(['PUSD']);
    expect(s.outStable).toBe(1);
  });

  it('writes the headline from the counts', () => {
    expect(block()).toContain('**3 crossings on 2 chains (Ethereum and BNB Smart Chain) in USDC and USDT; both ways on Ethereum.**');
    // Mutant: one ok crossing less must change the headline, so a README that kept the old number goes red.
    expect(block(runs.filter((r) => !r.includes('2026-11-17T11:00')))).toContain('**2 crossings on 2 chains');
  });

  it('counts each rule status, and keeps a written status', () => {
    const s = countStats(cfg, measured(runs));
    const [both, chains, stables, talk] = bounty.rows as [Row, Row, Row, Row];
    expect(rowStatus(both, s)).toBe('met');
    expect(rowStatus(chains, s)).toBe('met');
    expect(rowStatus(stables, s)).toBe('open');
    expect(rowStatus(talk, s)).toBe('open');
    const onlyOut = countStats(cfg, measured(runs.filter((r) => !r.includes('g3a'))));
    expect(rowStatus(both, onlyOut)).toBe('partly');
    expect(rowStatus(chains, countStats(cfg, measured([runs[2] ?? ''])))).toBe('partly');
    const twoStables = countStats(cfg, measured([...runs, `| 2026-11-18T07:00:00Z | in | 1 ETH.USDC to MUSD | bch ${h('9')} · eth 0x${h('8')} | 9.0 | ok |`]));
    expect(rowStatus(stables, twoStables)).toBe('met');
    const noStatus: Row = { section: talk.section, quote: talk.quote, note: talk.note, proof: talk.proof };
    expect(() => rowStatus(noStatus, s)).toThrow(/status or rule/);
  });

  it('quotes each requirement as written, links proofs relative to the file, and uses the language of the file', () => {
    const en = block();
    for (const r of bounty.rows) expect(en).toContain(`| ${r.quote} <sub>${r.section}</sub> | `);
    expect(en).toContain(`[out \`bch aaaaaaaa\`](https://bch.example/tx/${h('a')})`);
    expect(en).toContain('[Runs](docs/MEASURED.md#runs)');
    const judge = block(runs, 'docs/JUDGE.md');
    expect(judge).toContain('[Runs](MEASURED.md#runs)');
    expect(judge).toContain('[cost](../core/cost.ts)');
    const ms = block(runs, 'README.ms.md', 'ms');
    expect(ms).toContain('| Syarat | Sampan | Bukti |');
    expect(ms).toContain('**Belum.** ms Not done.');
    expect(ms).toContain('| Go both ways, & out of BCH <sub>Requirements</sub> |');
  });

  it('writes the 40-line docs/JUDGE.md block as one line of HTML with the same quotes, counts and links', () => {
    const html = bountyBlock(bounty, cfg, measured(runs), { path: 'docs/JUDGE.md', lang: 'en', html: true });
    expect(html.split('\n')).toHaveLength(2);
    expect(html).toContain('<b>3 crossings on 2 chains (Ethereum and BNB Smart Chain) in USDC and USDT; both ways on Ethereum.</b>');
    for (const r of bounty.rows) expect(html).toContain(`<td>${r.quote} <sub>${r.section}</sub></td>`);
    expect(html).toContain('<a href="MEASURED.md#runs">Runs</a>');
    expect(html).toContain(`<a href="https://bch.example/tx/${h('a')}">out <code>bch aaaaaaaa</code></a>`);
    expect(html).toContain('counted from MEASURED.md.</p><table>');
    expect(html).not.toMatch(/\]\(|\|/);
  });

  it('refuses a run proof with no ok crossing behind it', () => {
    expect(() => block(runs.filter((r) => !r.includes('| out | 1.8 PUSD')))).toThrow(/no ok crossing/);
  });

  it('replaces only the block', () => {
    const text = `a\n${block()}\nb`;
    expect(replaceBlock(text, block(runs.slice(0, 3)))).toBe(`a\n${block(runs.slice(0, 3))}\nb`);
    expect(currentBlock(text)).toBe(block());
  });

  it('README.md, README.ms.md and docs/JUDGE.md hold the block made from docs/MEASURED.md (run npm run bounty -- --write)', () => {
    const { b, cfg: live, measured: real } = load();
    const s = countStats(live, real);
    for (const r of b.rows) expect(r.status, `${r.quote}: run npm run bounty -- --write`).toBe(rowStatus(r, s));
    for (const target of TARGETS) {
      const text = readFileSync(repoFile(target.path), 'utf8');
      expect(currentBlock(text), `${target.path}: run npm run bounty -- --write`).toBe(bountyBlock(b, live, real, target));
    }
  });

  it('the shipped bounty file names a source on the organiser site and a proof for every row', () => {
    const { b } = load();
    expect(b.source.startsWith('https://bchblaze.cash')).toBe(true);
    expect(b.rows.length).toBeGreaterThanOrEqual(3);
    for (const r of b.rows) {
      expect(r.proof.length, r.quote).toBeGreaterThan(0);
      expect(r.status, r.quote).toMatch(/^(met|partly|open)$/);
    }
  });
});
