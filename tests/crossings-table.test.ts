import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { README_FILES, START, END, crossingFlows, crossingRows, legs, load, parseRuns, replaceRows, type CrossingsConfig, type Run } from '../scripts/crossings-table.js';

// A frozen fixture, not the shipped config or MEASURED.md: those change with every run.
const cfg: CrossingsConfig = {
  connect: { explorerTxUrl: 'https://bch.example/tx/{txid}' },
  thorchain: { explorerTxUrl: 'https://thor.example/tx/{txid}' },
  evm: { chains: [{ key: 'ETH', name: 'Ethereum', explorer: 'https://eth.example' }] },
  oneClick: { assets: [{ live: { out: false, in: false } }] },
};
const h = (c: string): string => c.repeat(64);
const measured = [
  '# Measured', '', '## Runs', '', '| UTC | flow | amount | txid | seconds | result |', '|---|---|---|---|---|---|',
  `| 2026-11-15T12:38:16Z | swap | 0.001 BCH to at least 0.19 PUSD | ${h('1')} | 1.4 | ok |`,
  `| 2026-11-17T11:00:00Z | g3a | 2 ETH.USDC to PUSD (landing address) | bch ${h('2')} · eth 0x${h('3')} · convert ${h('4')} | 2021.1 | ok |`,
  `| 2026-11-17T12:03:34Z | out | 1.8 PUSD to ETH.USDC (at least 1.49 USDC) | bch ${h('a')} · eth 0x${h('b')} | 373.7 | ok |`,
  `| 2026-11-18T03:28:37Z | in | 1.8 ETH.USDC to PUSD (landing address) | bch ${h('c')} · eth 0x${h('d')} · convert ${h('e')} | 219.0 | ok |`,
  `| 2026-11-18T04:00:00Z | out | 1.8 PUSD to ETH.USDC | - | 12.0 | fail (route refused) |`,
  `| 2026-11-18T05:00:00Z | oc-out | 2 PUSD to ETH.USDC | bch ${h('f')} · eth 0x${h('0')} | 80.0 | ok |`,
  '', '## Next', '| 2026-11-19T00:00:00Z | out | not a run | - | 1 | ok |',
].join('\n');

describe('crossings table', () => {
  it('reads only the Runs section', () => {
    expect(parseRuns(measured).map((r) => r.flow)).toEqual(['swap', 'g3a', 'out', 'in', 'out', 'oc-out']);
  });

  it('shows 1Click rows only in a direction with a live asset', () => {
    expect(crossingFlows(cfg)).toEqual(['out', 'in', 'g3a']);
    expect(crossingFlows({ ...cfg, oneClick: { assets: [{ live: { out: true } }] } })).toEqual(['out', 'in', 'g3a', 'oc-out']);
    expect(crossingRows(cfg, measured).some((r) => r.includes('1Click'))).toBe(false);
  });

  it('links every leg and the THORChain trace of the inbound leg, and keeps failed runs', () => {
    const [first, out, inn, failed] = crossingRows(cfg, measured);
    expect(first).toContain('| 11-17 11:00 | THORChain | Ethereum → BCH | USDC | 2 USDC | 2021.1 | ok |');
    expect(first).toContain(`[THORChain](https://thor.example/tx/${h('3')})`);
    expect(out).toBe(`| 11-17 12:03 | THORChain | BCH → Ethereum | USDC | 1.8 PUSD | 373.7 | ok | [\`bch aaaaaaaa\`](https://bch.example/tx/${h('a')}) · [\`eth 0xbbbbbbbb\`](https://eth.example/tx/0x${h('b')}) · [THORChain](https://thor.example/tx/${h('a')}) |`);
    expect(inn).toContain('| Ethereum → BCH | USDC | 1.8 USDC |');
    expect(inn).toContain(`[\`convert eeeeeeee\`](https://bch.example/tx/${h('e')})`);
    expect(inn).toContain(`[THORChain](https://thor.example/tx/${h('d')})`);
    expect(failed).toBe('| 11-18 04:00 | THORChain | BCH → Ethereum | USDC | 1.8 PUSD | 12.0 | fail (route refused) | - |');
  });

  it('leaves out no THORChain crossing in docs/MEASURED.md: every run with a CHAIN.ASSET amount and a bch and an EVM leg', () => {
    const { cfg: live, measured: real } = load();
    const evmKeys = live.evm.chains.map((ch) => ch.key.toLowerCase());
    const crossing = (r: Run): boolean => /\b[A-Z]+\.[A-Z]+\b/.test(r.amount)
      && legs(r.txid).some(([l]) => l === 'bch') && legs(r.txid).some(([l]) => evmKeys.includes(l));
    for (const [name, c, m] of [['fixture', cfg, measured], ['MEASURED.md', live, real]] as const) {
      const rows = crossingRows(c, m);
      for (const r of parseRuns(m).filter((x) => crossing(x) && !x.flow.startsWith('oc-'))) {
        expect(rows.some((row) => row.startsWith(`| ${r.utc.slice(5, 10)} ${r.utc.slice(11, 16)} |`)), `${name}: ${r.utc} ${r.flow}`).toBe(true);
      }
    }
  });

  it('refuses a leg or a chain without an explorer in config', () => {
    const noEth = { ...cfg, evm: { chains: [] } };
    expect(() => crossingRows(noEth, measured)).toThrow(/chain ETH not in evm.chains/);
    const odd = measured.replace(`eth 0x${h('b')}`, `sol 0x${h('b')}`);
    expect(() => crossingRows(cfg, odd)).toThrow(/no explorer for leg "sol"/);
    expect(legs(`bch ${h('a')} · eth 0x${h('b')}`)).toEqual([['bch', h('a')], ['eth', `0x${h('b')}`]]);
  });

  it('keeps each README its own header row and refuses a block without one', () => {
    const readme = `intro\n${START}\n| a | b |\n|---|---|\n| old |\n${END}\nafter`;
    expect(replaceRows(readme, ['| new |'])).toBe(`intro\n${START}\n| a | b |\n|---|---|\n| new |\n${END}\nafter`);
    expect(() => replaceRows(`${START}\n${END}`, [])).toThrow(/header row/);
    expect(() => replaceRows('no markers', [])).toThrow(/markers missing/);
  });

  it('both READMEs carry the table made from docs/MEASURED.md, with a link for every leg of every crossing', () => {
    const { cfg: live, measured: real } = load();
    const rows = crossingRows(live, real);
    const txids = parseRuns(real)
      .filter((r) => crossingFlows(live).includes(r.flow) && r.result === 'ok')
      .flatMap((r) => legs(r.txid).map(([, tx]) => tx));
    expect(txids.length).toBeGreaterThan(0);
    for (const f of README_FILES) {
      const readme = readFileSync(f, 'utf8');
      expect(replaceRows(readme, rows), `${f}: run npm run crossings -- --write`).toBe(readme);
      const block = readme.slice(readme.indexOf(START), readme.indexOf(END));
      for (const tx of txids) expect(block, `${f}: ${tx}`).toMatch(new RegExp(`\\]\\(https://[^)]*${tx}[^)]*\\)`));
    }
  });
});
