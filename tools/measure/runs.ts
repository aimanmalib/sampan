// The "Runs" table of docs/MEASURED.md: one row per measured mainnet run, failures included.
//   | UTC | flow | amount | txid | seconds | result |
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const FLOWS = ['swap', 'land', 'giveBack', 'out', 'in', 'g3a', 'oc-out', 'oc-in', 'refund', 'pay'] as const;
export type Flow = (typeof FLOWS)[number];

export interface Run {
  utc: Date;
  flow: Flow;
  /** What moved, e.g. "0.001 BCH to 0.52 PUSD". */
  amount: string;
  /** Full transaction id (or a crossing's ids from crossingTxid), undefined when the run failed before one existed. */
  txid?: string;
  seconds?: number;
  ok: boolean;
  /** Short reason, written after the result on failed runs. */
  note?: string;
}

export const RUNS_HEADER = ['| UTC | flow | amount | txid | seconds | result |', '|---|---|---|---|---|---|'];

const cell = (s: string): string => s.replace(/[|\n]/g, ' ').trim();

const BCH_TXID = /^[0-9a-f]{64}$/i;
const EVM_TXID = /^0x[0-9a-f]{64}$/i;
const SINGLE_TXID = /^(0x)?[0-9a-f]{64}$/i;
const CROSSING_TXID = /^bch [0-9a-f]{64} · [a-z]+ 0x[0-9a-f]{64}( · convert [0-9a-f]{64})?$/i;
const PAY_TXID = /^bch [0-9a-f]{64} · convert [0-9a-f]{64}$/i;

/** The txid cell of a crossing row: both chains in full, plus the landing's conversion when there is one. */
/** `bch <txid> · <chain> 0x<hash>[ · convert <txid>]`; the chain is the route's key in lower case (eth, bsc, avax, base). */
export function crossingTxid(ids: { bch: string; evm: { chain: string; hash: string }; convert?: string }): string {
  if (!BCH_TXID.test(ids.bch)) throw new Error(`not a BCH transaction id: ${ids.bch}`);
  if (!/^[a-z]+$/i.test(ids.evm.chain) || ids.evm.chain.toLowerCase() === 'bch') throw new Error(`not an EVM chain key: ${ids.evm.chain}`);
  if (!EVM_TXID.test(ids.evm.hash)) throw new Error(`not an EVM transaction id: ${ids.evm.hash}`);
  if (ids.convert !== undefined && !BCH_TXID.test(ids.convert)) throw new Error(`not a BCH transaction id: ${ids.convert}`);
  const convert = ids.convert ? ` · convert ${ids.convert.toLowerCase()}` : '';
  return `bch ${ids.bch.toLowerCase()} · ${ids.evm.chain.toLowerCase()} ${ids.evm.hash.toLowerCase()}${convert}`;
}

/** The txid cell of a Sampan Pay row: the customer's payment and the conversion that paid the merchant. */
export function payTxid(ids: { pay: string; convert: string }): string {
  for (const id of [ids.pay, ids.convert]) if (!BCH_TXID.test(id)) throw new Error(`not a BCH transaction id: ${id}`);
  return `bch ${ids.pay.toLowerCase()} · convert ${ids.convert.toLowerCase()}`;
}

export function runRow(r: Run): string {
  if (r.txid !== undefined && !SINGLE_TXID.test(r.txid) && !CROSSING_TXID.test(r.txid) && !PAY_TXID.test(r.txid)) throw new Error(`not a transaction id: ${r.txid}`);
  const utc = r.utc.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const seconds = r.seconds === undefined ? '-' : r.seconds.toFixed(1);
  const result = r.ok ? 'ok' : r.note ? `fail (${cell(r.note)})` : 'fail';
  return `| ${utc} | ${r.flow} | ${cell(r.amount)} | ${r.txid ?? '-'} | ${seconds} | ${result} |`;
}

/** Appends rows to the Runs table; creates the file with its heading when it does not exist yet. */
export function appendRuns(file: string, runs: Run[]): void {
  if (!existsSync(file)) writeFileSync(file, ['# Measured', '', '## Runs', '', ...RUNS_HEADER, ''].join('\n'));
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const header = lines.indexOf(RUNS_HEADER[0]!);
  if (header < 0) throw new Error(`${file} has no Runs table`);
  let end = header + 2;
  while (end < lines.length && lines[end]!.startsWith('|')) end += 1;
  lines.splice(end, 0, ...runs.map(runRow));
  writeFileSync(file, lines.join('\n'));
}

/** Counts ok rows of one flow, as the gate counts them. */
export function countOk(text: string, flow: Flow): number {
  return text.split('\n').filter((l) => {
    const c = l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
    return c.length >= 6 && c[1] === flow && c[c.length - 1] === 'ok' && /[0-9a-f]{64}/i.test(l);
  }).length;
}
