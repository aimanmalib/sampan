// The "Judge path" table of docs/MEASURED.md (KP23): one row per timed judge path on the live site.
//   | UTC | engine | path | seconds | actions | commit |
// "seconds" runs from page.goto until a real mainnet transaction id is visible on screen. "actions" counts what a
// person does on the page (clicks, typing, scrolling) and, for the path with a wallet, what they do in the wallet,
// which a machine cannot time.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const ENGINES = ['webkit-iphone13', 'chromium-desktop'] as const;
export type Engine = (typeof ENGINES)[number];
export const PATHS = ['see', 'do'] as const;
/** The docs/JUDGE.md walk on a phone (--judge-md): taps from load to an explorer transaction page, and to a refusal
 *  shown on the "Try to cheat it" panel. Target: 6 taps or fewer each (KMN4). */
export const JUDGE_MD_PATHS = ['judge-md', 'judge-md-cheat'] as const;
export type JudgePath = (typeof PATHS)[number] | (typeof JUDGE_MD_PATHS)[number];
const ALL_PATHS: readonly string[] = [...PATHS, ...JUDGE_MD_PATHS];

/** One timed step of a path, for the step list kept outside the repository and for the action count. */
export interface Step {
  /** Seconds since page.goto started. */
  at: number;
  kind: 'load' | 'click' | 'type' | 'scroll' | 'wait' | 'wallet';
  what: string;
}

export interface JudgeRow {
  utc: Date;
  engine: Engine;
  path: JudgePath;
  seconds: number;
  /** Clicks, typing and scrolls on the page. */
  pageActions: number;
  /** Actions in the wallet (pair, approve), counted rather than timed. Zero on the path without a wallet. */
  walletActions: number;
  /** Short commit of the deployed build that was measured. */
  commit: string;
}

export const JUDGE_HEADING = '## Judge path';
export const JUDGE_HEADER = ['| UTC | engine | path | seconds | actions | commit |', '|---|---|---|---|---|---|'];

const PAGE_KINDS: ReadonlySet<Step['kind']> = new Set(['click', 'type', 'scroll']);

/** Page and wallet action counts of a step list. Loads and waits are not actions. */
export function countActions(steps: Step[]): { pageActions: number; walletActions: number } {
  return {
    pageActions: steps.filter((s) => PAGE_KINDS.has(s.kind)).length,
    walletActions: steps.filter((s) => s.kind === 'wallet').length,
  };
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

export function judgeRow(r: JudgeRow): string {
  if (!/^[0-9a-f]{7,40}$/.test(r.commit)) throw new Error(`not a commit: ${r.commit}`);
  if (!Number.isFinite(r.seconds) || r.seconds < 0) throw new Error(`not a duration: ${r.seconds}`);
  const utc = r.utc.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const wallet = r.walletActions > 0 ? ` + ${plural(r.walletActions, 'wallet action')}` : '';
  const actions = `${plural(r.pageActions, 'page action')}${wallet}`;
  return `| ${utc} | ${r.engine} | ${r.path} | ${r.seconds.toFixed(1)} | ${actions} | ${r.commit} |`;
}

/** The rows of the Judge path table as engine, path and seconds, the way the gate reads them. */
export function parseJudge(text: string): Array<{ engine: string; path: string; seconds: number }> {
  const start = text.split('\n').indexOf(JUDGE_HEADING);
  if (start < 0) return [];
  const rows: Array<{ engine: string; path: string; seconds: number }> = [];
  for (const line of text.split('\n').slice(start + 1)) {
    if (line.startsWith('## ')) break;
    const c = line.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
    if (c.length >= 6 && ALL_PATHS.includes(c[2]!) && /^\d+(\.\d+)?$/.test(c[3]!)) {
      rows.push({ engine: c[1]!, path: c[2]!, seconds: Number(c[3]) });
    }
  }
  return rows;
}

/** Appends rows to the Judge path table, adding the section at the end of the file the first time. */
export function appendJudge(file: string, rows: JudgeRow[]): void {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '# Measured\n';
  const lines = text.replace(/\n+$/, '').split('\n');
  let header = lines.indexOf(JUDGE_HEADER[0]!);
  if (header < 0 || !lines.slice(0, header).includes(JUDGE_HEADING)) {
    lines.push('', JUDGE_HEADING, '', ...JUDGE_HEADER);
    header = lines.length - 2;
  }
  let end = header + 2;
  while (end < lines.length && lines[end]!.startsWith('|')) end += 1;
  lines.splice(end, 0, ...rows.map(judgeRow));
  writeFileSync(file, `${lines.join('\n')}\n`);
}
