// Reads docs/MEASURED.md (the Runs table and the Wallets checked table) into the summary the /how page shows.
// Pure: no file access, so the page build, the tests and the CLI share one parser.
//   | UTC | flow | amount | txid | seconds | result |
export const PROOF_FLOWS = ['swap', 'land', 'giveBack', 'out', 'in', 'g3a', 'refund'] as const;
export type ProofFlowId = (typeof PROOF_FLOWS)[number];

export interface ProofTxid {
  chain: 'bch' | 'base';
  /** Full id as written in MEASURED.md (Base ids keep their 0x). */
  id: string;
}

export interface ProofRun {
  utc: string;
  flow: ProofFlowId;
  amount: string;
  seconds: number | null;
  ok: boolean;
  /** Empty when the run failed before a transaction existed. A crossing has one id per chain. */
  txids: ProofTxid[];
}

export interface ProofFlow {
  flow: ProofFlowId;
  /** Result ok and at least one full transaction id. */
  ok: number;
  /** Result fail. */
  fail: number;
  /** Result ok but no full transaction id: shown apart, never counted as ok. */
  unproven: number;
  /** Median of the ok rows that have a time; null when none has. */
  medianSeconds: number | null;
  /** The earliest ok row of the flow. */
  first: ProofRun | null;
}

export interface Proof {
  flows: ProofFlow[];
  wallets: number;
  /** Newest first. */
  runs: ProofRun[];
}

const BCH_TXID = /^[0-9a-f]{64}$/i;
const EVM_TXID = /^0x[0-9a-f]{64}$/i;

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/** Rows of the markdown table whose header line is exactly `header`, as cell arrays. */
function tableRows(lines: string[], header: RegExp): string[][] {
  const start = lines.findIndex((l) => header.test(l.trim()));
  if (start < 0) return [];
  const rows: string[][] = [];
  for (let i = start + 2; i < lines.length && lines[i]!.trim().startsWith('|'); i += 1) rows.push(cells(lines[i]!));
  return rows;
}

/** One txid cell: a single BCH id, a single Base id, or a crossing `bch … · base 0x… · convert …`. */
export function parseTxids(cell: string): ProofTxid[] {
  const one = cell.trim();
  if (BCH_TXID.test(one)) return [{ chain: 'bch', id: one.toLowerCase() }];
  if (EVM_TXID.test(one)) return [{ chain: 'base', id: one.toLowerCase() }];
  const out: ProofTxid[] = [];
  for (const part of one.split('·').map((p) => p.trim())) {
    const m = /^(bch|base|convert) (\S+)$/i.exec(part);
    if (!m) return [];
    const id = m[2]!.toLowerCase();
    const chain = m[1]!.toLowerCase() === 'base' ? 'base' : 'bch';
    if (!(chain === 'base' ? EVM_TXID : BCH_TXID).test(id)) return [];
    out.push({ chain, id });
  }
  return out;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function parseRuns(markdown: string): ProofRun[] {
  const rows = tableRows(markdown.split('\n'), /^\| UTC \| flow \| amount \| txid \| seconds \| result \|$/);
  const runs: ProofRun[] = [];
  for (const c of rows) {
    if (c.length < 6) continue;
    const [utc, flow, amount, txid, seconds, ...rest] = c;
    if (!(PROOF_FLOWS as readonly string[]).includes(flow!)) continue;
    const result = rest.join('|');
    const secs = Number(seconds);
    runs.push({
      utc: utc!,
      flow: flow as ProofFlowId,
      amount: amount!,
      seconds: seconds === '-' || !Number.isFinite(secs) ? null : secs,
      ok: result === 'ok',
      txids: parseTxids(txid!),
    });
  }
  return runs;
}

/** Wallet rows of the "Wallets checked" table. */
export function countWallets(markdown: string): number {
  return tableRows(markdown.split('\n'), /^\| Wallet \| How \| Result \|$/).length;
}

/** Every transaction id in the Runs table, lower case without 0x: all of them were made by the team's own wallets. */
export function proofTxids(p: Proof): string[] {
  return [...new Set(p.runs.flatMap((r) => r.txids.map((t) => normalTxid(t.id))))];
}

/** Lower case, no 0x: how a BCH id and a Base id compare with the ids the server stores. */
export const normalTxid = (id: string): string => id.toLowerCase().replace(/^0x/, '');

export function buildProof(markdown: string): Proof {
  const runs = parseRuns(markdown);
  const flows: ProofFlow[] = [];
  for (const flow of PROOF_FLOWS) {
    const rows = runs.filter((r) => r.flow === flow);
    if (rows.length === 0) continue;
    const ok = rows.filter((r) => r.ok && r.txids.length > 0);
    flows.push({
      flow,
      ok: ok.length,
      fail: rows.filter((r) => !r.ok).length,
      unproven: rows.filter((r) => r.ok && r.txids.length === 0).length,
      medianSeconds: median(ok.flatMap((r) => (r.seconds === null ? [] : [r.seconds]))),
      first: [...ok].sort((a, b) => a.utc.localeCompare(b.utc))[0] ?? null,
    });
  }
  const newest = runs.map((r, i) => ({ r, i })).sort((a, b) => b.r.utc.localeCompare(a.r.utc) || b.i - a.i);
  return { flows, wallets: countWallets(markdown), runs: newest.map((x) => x.r) };
}
