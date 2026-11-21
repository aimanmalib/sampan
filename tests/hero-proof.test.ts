// K6P6: the proof line by the card is the newest ok stablecoin crossing into PUSD in the Runs table, picked by a function.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateConfig, type SampanConfig } from '../core/config.js';
import { heroProof } from '../core/hero-proof.js';
import { buildProof } from '../core/proof.js';
import { measuredJson } from '../scripts/measured-json.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);
const E = `0x${'e'.repeat(64)}`;
const F = `0x${'f'.repeat(64)}`;
const STABLE = ['USDC', 'USDT'];

const table = (rows: string[]): string =>
  ['## Runs', '', '| UTC | flow | amount | txid | seconds | result |', '|---|---|---|---|---|---|', ...rows, ''].join('\n');

const rows = [
  `| 2026-11-18T03:28:37Z | in | 1.8 ETH.USDC to PUSD (landing address) | bch ${A} · eth ${E} · convert ${C} | 219.0 | ok |`,
  `| 2026-11-19T00:41:16Z | in | 1.6 BSC.USDT to PUSD (landing address) | bch ${B} · bsc ${F} · convert ${C} | 48.4 | ok |`,
  `| 2026-11-19T02:00:00Z | out | 2 PUSD to BSC.USDC | bch ${D} · bsc ${E} | 98.0 | ok |`,
  `| 2026-11-19T03:00:00Z | in | 1.6 AVAX.USDC to PUSD | bch ${D} · avax ${E} | 50.0 | fail (dropped) |`,
  `| 2026-11-19T04:00:00Z | swap | 0.001 BCH to 0.18 PUSD | ${D} | 4.4 | ok |`,
];

describe('heroProof', () => {
  it('picks the newest ok stablecoin crossing into PUSD, skipping failed, outgoing and swap rows', () => {
    const p = heroProof(buildProof(table(rows)), STABLE);
    expect(p).toEqual({
      utc: '2026-11-19T00:41:16Z',
      amount: '1.6',
      symbol: 'USDT',
      chain: 'bsc',
      seconds: 48.4,
      bch: { chain: 'bch', id: B },
      evm: { chain: 'bsc', id: F },
    });
  });

  it('changes when a newer ok crossing is added (a NEAR Intents one counts too)', () => {
    const newer = `| 2026-11-20T01:48:03Z | oc-in | 1.35 BASE.USDC to PUSD (landing address) | bch ${D} · base ${E} · convert ${C} | - | ok |`;
    const p = heroProof(buildProof(table([...rows, newer])), STABLE);
    expect(p).toMatchObject({ amount: '1.35', symbol: 'USDC', chain: 'base', seconds: null, bch: { id: D } });
  });

  it('skips a row without the other chain transaction, a symbol config does not name, and draws nothing for "none"', () => {
    const noEvm = `| 2026-11-21T00:00:00Z | in | 2 ETH.USDC to PUSD | ${D} | 60.0 | ok |`;
    const other = `| 2026-11-21T01:00:00Z | in | 2 ETH.DAI to PUSD | bch ${D} · eth ${E} | 60.0 | ok |`;
    const proof = buildProof(table([...rows, noEvm, other]));
    expect(heroProof(proof, STABLE)?.utc).toBe('2026-11-19T00:41:16Z');
    expect(heroProof(proof, STABLE, 'none')).toBeNull();
    expect(heroProof(buildProof(table([rows[2]!, rows[4]!])), STABLE)).toBeNull();
  });

  it('finds a crossing in docs/MEASURED.md as shipped (shape, not the values)', () => {
    const shipped = JSON.parse(readFileSync('config/sampan.json', 'utf8')) as { route: { symbols: string[] }; ui: { heroProof: 'latest-in' | 'none' } };
    const p = heroProof(measuredJson(), shipped.route.symbols, 'latest-in');
    expect(p).not.toBeNull();
    expect(shipped.route.symbols).toContain(p!.symbol);
    expect(p!.amount).toMatch(/^\d+(\.\d+)?$/);
    expect(p!.bch.id).toMatch(/^[0-9a-f]{64}$/);
    expect(p!.evm.id).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('config ui.heroProof and ui.heroTab', () => {
  const shipped = JSON.parse(readFileSync('config/sampan.json', 'utf8')) as SampanConfig;
  const withUi = (ui: Record<string, unknown>): string => validateConfig({ ...shipped, ui: { ...shipped.ui, ...ui } } as SampanConfig).join();

  it('ships the swap tab first and a valid proof line kind', () => {
    expect(shipped.ui.heroTab).toBe('swap');
    expect(['latest-in', 'none']).toContain(shipped.ui.heroProof);
    expect(withUi({})).toBe('');
  });

  it('refuses a value outside the lists', () => {
    expect(withUi({ heroProof: 'oldest' })).toContain('ui.heroProof');
    expect(withUi({ heroTab: 'pay' })).toContain('ui.heroTab');
    expect(withUi({ heroProof: 'none', heroTab: 'in' })).toBe('');
  });
});
