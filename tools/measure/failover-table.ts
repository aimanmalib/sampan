// The Failover table in docs/MEASURED.md: one row per case, written again as a whole on every run so the table
// always describes one run of tools/measure/failover.ts against one commit.

/** A closed local port: the connection is refused at once. */
export const REFUSED_HOST = '127.0.0.1:9';
/** A private address that never answers inside this network: the client waits for its own timeout. */
export const SILENT_HOST = '10.255.255.1';

export interface CaseOutcome {
  /** HTTP status, or 0 when the request itself failed. */
  status: number;
  ms: number;
  /** The `error` code of a failed answer, if any. */
  error?: string;
}

export interface FailoverRow {
  at: string;
  id: string;
  broken: string;
  /** Seconds from starting the server until /api/health has its first report. */
  firstHealthS: number;
  health: string;
  quote: CaseOutcome;
  scan: CaseOutcome;
  /** Only for cases that open crossings. */
  route?: CaseOutcome;
  page: string;
  commit: string;
}

export const FAILOVER_HEADING = '## Failover';
const HEADER = [
  '| UTC | case | what was broken | first health report (s) | health | swap quote | wallet scan | route quote | page shows | commit |',
  '|---|---|---|---|---|---|---|---|---|---|',
];

export function outcomeCell(o: CaseOutcome | undefined): string {
  if (!o) return 'not asked';
  const s = (o.ms / 1000).toFixed(1);
  return o.status === 200 ? `200 in ${s} s` : `${o.status || 'no answer'}${o.error ? ` ${o.error}` : ''} in ${s} s`;
}

const cell = (s: string): string => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

export function failoverRow(r: FailoverRow): string {
  return `| ${r.at} | ${r.id} | ${cell(r.broken)} | ${r.firstHealthS.toFixed(1)} | ${cell(r.health)} | ${outcomeCell(r.quote)} | ${outcomeCell(r.scan)} | ${outcomeCell(r.route)} | ${cell(r.page)} | ${r.commit} |`;
}

const INTRO =
  'Measured with `tools/measure/failover.ts`: the built server on the host, the real providers, and the config patched so ' +
  `that one provider is replaced by an address that refuses the connection (\`${REFUSED_HOST}\`) or never answers ` +
  `(\`${SILENT_HOST}\`). "base" rows use the shipped config. Times are one request each, after the first health report.`;

/** Replaces the Failover section (heading to the next `## ` or the end) or appends it. */
export function writeFailoverSection(markdown: string, rows: FailoverRow[]): string {
  const section = [FAILOVER_HEADING, '', INTRO, '', ...HEADER, ...rows.map(failoverRow), ''].join('\n');
  const start = markdown.indexOf(`\n${FAILOVER_HEADING}\n`);
  if (start < 0) return `${markdown.replace(/\n*$/, '\n')}\n${section}`;
  const next = markdown.indexOf('\n## ', start + 1);
  const tail = next < 0 ? '' : markdown.slice(next + 1);
  return `${markdown.slice(0, start + 1)}${section}${tail ? `\n${tail}` : ''}`;
}

/** Health report in words: each provider up, down or not checked yet. */
export function healthWords(h: { cauldron: boolean | null; bch: boolean | null; route: { open: boolean | null } | null }): string {
  const w = (v: boolean | null): string => (v === null ? 'unknown' : v ? 'up' : 'down');
  const parts = [`pools ${w(h.cauldron)}`, `BCH servers ${w(h.bch)}`];
  if (h.route) parts.push(`route ${h.route.open === null ? 'not answering' : h.route.open ? 'open' : 'paused'}`);
  return parts.join(', ');
}
