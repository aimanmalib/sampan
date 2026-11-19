// The Judge path table writer and reader (KP23). No browser, no network.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendJudge, countActions, judgeRow, parseJudge, type JudgeRow, type Step } from '../tools/measure/judge-table.js';
import { parseRuns } from '../core/proof.js';

const UTC = new Date('2026-11-16T12:00:00.123Z');
const row = (o: Partial<JudgeRow> = {}): JudgeRow => ({
  utc: UTC,
  engine: 'webkit-iphone13',
  path: 'see',
  seconds: 4.26,
  pageActions: 1,
  walletActions: 0,
  commit: '324135c',
  ...o,
});

const dirs: string[] = [];
const file = (text?: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'judge-'));
  dirs.push(dir);
  const f = path.join(dir, 'MEASURED.md');
  if (text !== undefined) writeFileSync(f, text);
  return f;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const RUNS = ['# Measured', '', '## Runs', '', '| UTC | flow | amount | txid | seconds | result |', '|---|---|---|---|---|---|',
  `| 2026-11-15T10:00:00Z | swap | 0.001 BCH to at least 0.20 PUSD | ${'ab'.repeat(32)} | 9.0 | ok |`, '', '## Wallets checked', '', '| Wallet | How | Result |', '|---|---|---|', '| a | b | c |', ''].join('\n');

describe('countActions', () => {
  it('counts clicks, typing and scrolls as page actions and wallet steps apart; loads and waits are not actions', () => {
    const steps: Step[] = [
      { at: 0, kind: 'load', what: 'front page' },
      { at: 1, kind: 'scroll', what: 'to Measured' },
      { at: 1.2, kind: 'click', what: 'Connect' },
      { at: 2, kind: 'wallet', what: 'pair' },
      { at: 3, kind: 'wait', what: 'wallet connected' },
      { at: 3.5, kind: 'type', what: 'amount' },
      { at: 4, kind: 'wallet', what: 'approve' },
    ];
    expect(countActions(steps)).toEqual({ pageActions: 3, walletActions: 2 });
  });
});

describe('judgeRow', () => {
  it('writes UTC to the second, seconds to one decimal and the actions in words', () => {
    expect(judgeRow(row())).toBe('| 2026-11-16T12:00:00Z | webkit-iphone13 | see | 4.3 | 1 page action | 324135c |');
    expect(judgeRow(row({ path: 'do', engine: 'chromium-desktop', seconds: 31, pageActions: 3, walletActions: 2 }))).toBe(
      '| 2026-11-16T12:00:00Z | chromium-desktop | do | 31.0 | 3 page actions + 2 wallet actions | 324135c |',
    );
  });

  it('refuses a commit that is not a hash and a duration that is not a number', () => {
    expect(() => judgeRow(row({ commit: 'live' }))).toThrow(/commit/);
    expect(() => judgeRow(row({ seconds: Number.NaN }))).toThrow(/duration/);
  });
});

describe('appendJudge and parseJudge', () => {
  it('adds the section once at the end, appends under it, and leaves the Runs table as it was', () => {
    const f = file(RUNS);
    appendJudge(f, [row(), row({ path: 'do', seconds: 40.04, pageActions: 3, walletActions: 2 })]);
    appendJudge(f, [row({ engine: 'chromium-desktop', seconds: 2.5 })]);
    const text = readFileSync(f, 'utf8');
    expect(text.match(/^## Judge path$/gm)).toHaveLength(1);
    expect(text.indexOf('## Judge path')).toBeGreaterThan(text.indexOf('## Wallets checked'));
    expect(parseJudge(text)).toEqual([
      { engine: 'webkit-iphone13', path: 'see', seconds: 4.3 },
      { engine: 'webkit-iphone13', path: 'do', seconds: 40 },
      { engine: 'chromium-desktop', path: 'see', seconds: 2.5 },
    ]);
    expect(parseRuns(text)).toEqual(parseRuns(RUNS));
    expect(text.endsWith('|\n')).toBe(true);
  });

  it('reads nothing when there is no Judge path section, and stops at the next section', () => {
    expect(parseJudge(RUNS)).toEqual([]);
    const text = `${RUNS}\n## Judge path\n\n| UTC | engine | path | seconds | actions | commit |\n|---|---|---|---|---|---|\n${judgeRow(row())}\n\n## Later\n\n| x | y | see | 9 | a | b |\n`;
    expect(parseJudge(text)).toEqual([{ engine: 'webkit-iphone13', path: 'see', seconds: 4.3 }]);
  });

  it('reads the docs/JUDGE.md walk rows (judge-md, judge-md-cheat) beside see and do', () => {
    const f = file(RUNS);
    appendJudge(f, [row({ path: 'judge-md', seconds: 6.04, pageActions: 3 }), row({ path: 'judge-md-cheat', seconds: 5, pageActions: 4 })]);
    const text = readFileSync(f, 'utf8');
    expect(text).toContain('| judge-md | 6.0 | 3 page actions |');
    expect(parseJudge(text)).toEqual([
      { engine: 'webkit-iphone13', path: 'judge-md', seconds: 6 },
      { engine: 'webkit-iphone13', path: 'judge-md-cheat', seconds: 5 },
    ]);
  });

  it('creates the file when it does not exist', () => {
    const f = file();
    appendJudge(f, [row()]);
    expect(parseJudge(readFileSync(f, 'utf8'))).toHaveLength(1);
  });
});
