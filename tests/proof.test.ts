import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildProof, countWallets, median, parseRuns, parseTxids } from '../core/proof.js';
import { measuredJson } from '../scripts/measured-json.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const E = `0x${'e'.repeat(64)}`;

const fixture = [
  '# Measured',
  '',
  '## Runs',
  '',
  '| UTC | flow | amount | txid | seconds | result |',
  '|---|---|---|---|---|---|',
  `| 2026-11-15T12:00:00Z | swap | 0.001 BCH to 0.19 PUSD | ${A} | 2.0 | ok |`,
  '| 2026-11-15T12:01:00Z | swap | 0.4 PUSD to BCH | - | 0.8 | fail (Your wallet did not sign. Nothing was sent.) |',
  `| 2026-11-15T12:02:00Z | swap | 0.001 BCH to 0.19 PUSD | ${B} | 4.0 | ok |`,
  '| 2026-11-15T12:03:00Z | swap | 0.001 BCH to 0.19 PUSD | not-a-txid | 1.0 | ok |',
  `| 2026-11-15T12:04:00Z | land | 0.001 BCH to 0.20 PUSD | ${C} | - | ok |`,
  `| 2026-11-17T13:00:00Z | out | 2.00 PUSD to 1.75 USDC | bch ${A} · base ${E} | 900.0 | ok |`,
  `| 2026-11-17T14:00:00Z | in | 2 USDC to PUSD | bch ${B} · base ${E} · convert ${C} | 700.0 | ok |`,
  '| 2026-11-17T15:00:00Z | out | 2.00 PUSD | - | 30.0 | fail (route halted) |',
  '',
  '## Wallets checked',
  '',
  '| Wallet | How | Result |',
  '|---|---|---|',
  '| Test wallet | headless | ok |',
  '| Phone | by hand | ok |',
  '',
].join('\n');

describe('proof from MEASURED.md', () => {
  it('reads single and crossing txid cells and refuses anything else', () => {
    expect(parseTxids(A)).toEqual([{ chain: 'bch', id: A }]);
    expect(parseTxids(E.toUpperCase().replace('0X', '0x'))).toEqual([{ chain: 'base', id: E }]);
    expect(parseTxids(`bch ${A} · base ${E} · convert ${C}`)).toEqual([
      { chain: 'bch', id: A },
      { chain: 'base', id: E },
      { chain: 'bch', id: C },
    ]);
    expect(parseTxids('-')).toEqual([]);
    expect(parseTxids(`bch ${A} · base ${A}`)).toEqual([]);
    expect(parseTxids(A.slice(1))).toEqual([]);
  });

  it('counts ok rows with a full txid apart from failed rows and ok rows without one', () => {
    const p = buildProof(fixture);
    const swap = p.flows.find((f) => f.flow === 'swap')!;
    expect(swap).toMatchObject({ ok: 2, fail: 1, unproven: 1, medianSeconds: 3 });
    expect(swap.first?.txids).toEqual([{ chain: 'bch', id: A }]);
    const out = p.flows.find((f) => f.flow === 'out')!;
    expect(out).toMatchObject({ ok: 1, fail: 1, unproven: 0, medianSeconds: 900 });
    expect(out.first?.txids.map((x) => x.chain)).toEqual(['bch', 'base']);
    expect(p.flows.find((f) => f.flow === 'land')).toMatchObject({ ok: 1, medianSeconds: null });
  });

  it('leaves out flows with no rows and lists runs newest first', () => {
    const p = buildProof(fixture);
    expect(p.flows.map((f) => f.flow)).toEqual(['swap', 'land', 'out', 'in']);
    expect(p.runs[0]!.utc).toBe('2026-11-17T15:00:00Z');
    expect(p.runs.at(-1)!.utc).toBe('2026-11-15T12:00:00Z');
    expect(p.wallets).toBe(2);
  });

  it('takes the median of an even count as the mean of the middle two', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('proof from the real docs/MEASURED.md', () => {
  const text = readFileSync(new URL('../docs/MEASURED.md', import.meta.url), 'utf8');
  // Dated rows of the Runs section only: the Judge path table further down also starts each row with a UTC time.
  const runsSection = text.slice(text.indexOf('## Runs'), text.indexOf('\n## ', text.indexOf('## Runs') + 1));
  const table = runsSection.split('\n').filter((l) => /^\| \d{4}-\d\d-\d\dT/.test(l));

  it('reads every Runs row and every wallet row', () => {
    const p = measuredJson();
    expect(p.runs.length).toBe(parseRuns(text).length);
    expect(parseRuns(text).length).toBe(table.length);
    expect(p.wallets).toBe(countWallets(text));
    expect(p.wallets).toBeGreaterThan(0);
  });

  it('counts ok and fail per flow as the rows say', () => {
    const p = measuredJson();
    for (const f of p.flows) {
      const rows = table.filter((l) => l.split('|')[2]!.trim() === f.flow);
      const ok = rows.filter((l) => /\| ok \|$/.test(l.trim()) && /[0-9a-f]{64}/i.test(l));
      expect(f.ok + f.fail + f.unproven).toBe(rows.length);
      expect(f.ok).toBe(ok.length);
    }
  });

  it('keeps the first swap txid in full', () => {
    const first = table.find((l) => l.split('|')[2]!.trim() === 'swap' && /\| ok \|$/.test(l.trim()))!;
    const id = /[0-9a-f]{64}/.exec(first)![0];
    expect(measuredJson().flows.find((f) => f.flow === 'swap')!.first!.txids[0]!.id).toBe(id);
  });
});
