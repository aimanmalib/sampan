// Spending record of the test wallet (state/test-ledger.jsonl, not tracked). One JSON line per signature.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

export interface LedgerLine {
  utc: string;
  usd: number;
  prompt: string;
}

export function spentOn(file: string, day: string): number {
  if (!existsSync(file)) return 0;
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LedgerLine)
    .filter((l) => l.utc.slice(0, 10) === day)
    .reduce((sum, l) => sum + l.usd, 0);
}

export function record(file: string, line: LedgerLine): void {
  appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
}
