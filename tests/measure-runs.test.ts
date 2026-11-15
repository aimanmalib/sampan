import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendRuns, countOk, runRow } from '../tools/measure/runs.js';

const TXID = 'ab'.repeat(32);
const at = new Date('2026-11-15T13:00:00.250Z');
let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('MEASURED runs table', () => {
  it('writes an ok row in the gate shape and a failed row with its reason', () => {
    expect(runRow({ utc: at, flow: 'swap', amount: '0.001 BCH to 0.52 PUSD', txid: TXID, seconds: 4.26, ok: true })).toBe(
      `| 2026-11-15T13:00:00Z | swap | 0.001 BCH to 0.52 PUSD | ${TXID} | 4.3 | ok |`,
    );
    const failed = runRow({ utc: at, flow: 'swap', amount: '1 PUSD | to BCH', ok: false, note: 'wallet refused' });
    expect(failed).toBe('| 2026-11-15T13:00:00Z | swap | 1 PUSD   to BCH | - | - | fail (wallet refused) |');
    expect(countOk(failed, 'swap')).toBe(0);
  });

  it('refuses a malformed transaction id', () => {
    expect(() => runRow({ utc: at, flow: 'swap', amount: 'x', txid: 'abc', ok: true })).toThrow(/not a transaction id/);
  });

  it('creates the file, appends under the table and keeps later sections', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sampan-measured-'));
    const file = path.join(dir, 'MEASURED.md');
    appendRuns(file, [{ utc: at, flow: 'swap', amount: 'a', txid: TXID, seconds: 1, ok: true }]);
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n## Other\n\ntext\n`);
    appendRuns(file, [
      { utc: at, flow: 'swap', amount: 'b', txid: 'cd'.repeat(32), seconds: 2, ok: true },
      { utc: at, flow: 'land', amount: 'c', txid: 'ef'.repeat(32), seconds: 3, ok: true },
    ]);
    const text = readFileSync(file, 'utf8');
    expect(countOk(text, 'swap')).toBe(2);
    expect(countOk(text, 'land')).toBe(1);
    expect(text.indexOf('| b |')).toBeLessThan(text.indexOf('## Other'));
  });
});
