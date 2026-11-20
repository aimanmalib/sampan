// The bounty table in README.md, README.ms.md and docs/JUDGE.md: each requirement of the bounty, quoted word for word in
// docs/bounty/stablecoin-bridge.json, beside what Sampan does and a link to the proof. The headline counts (crossings,
// chains, symbols, chains measured both ways) and every status with a `rule` are counted here from the ok crossings in
// the Runs table of docs/MEASURED.md, with the same flows as scripts/crossings-table.ts. All words live in the JSON file.
//   npm run bounty              print the English block
//   npm run bounty -- --write   rewrite the block in the three files
// tests/bounty-table.test.ts fails when a file and the generator disagree.
import { readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crossingFlows, legs, parseRuns, type CrossingsConfig, type Run } from './crossings-table.js';

const file = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
export const START = '<!-- bounty:start (made by scripts/bounty-table.ts from docs/bounty/stablecoin-bridge.json and docs/MEASURED.md) -->';
export const END = '<!-- bounty:end -->';
const MEASURED = 'docs/MEASURED.md';
export const BOUNTY_FILE = 'docs/bounty/stablecoin-bridge.json';

export type Lang = 'en' | 'ms';
/** Each file with the block: its repo path and its language. */
// docs/JUDGE.md is held to 40 lines, so its block is one line of HTML (the markers on their own lines would cost two).
export interface Target { path: string; lang: Lang; html?: boolean }
export const TARGETS: ReadonlyArray<Target> = [
  { path: 'README.md', lang: 'en' },
  { path: 'README.ms.md', lang: 'ms' },
  { path: 'docs/JUDGE.md', lang: 'en', html: true },
];

export type Status = 'met' | 'partly' | 'open';
type Text = Record<Lang, string>;
export interface Proof { kind: 'runs' | 'file' | 'url'; ref: string; flows?: string[]; label: Text }
export interface Row { section: string; quote: string; status?: Status; rule?: string; note: Text; proof: Proof[] }
export interface Bounty {
  source: string; readUtc: string; bounty: string;
  intro: Text; headline: Text; columns: Record<Lang, string[]>;
  statusLabels: Record<Lang, Record<Status, string>>; joinWord: Text; rows: Row[];
}
export interface BountyConfig extends CrossingsConfig { tokens: Record<string, unknown> }

export interface Stats {
  crossings: number; inCount: number; outStable: number; thorchain: number; pusd: number;
  chains: string[]; symbols: string[]; bothWays: string[]; bchStables: string[];
  /** Distinct mainnet transaction ids across the ok crossings (every leg: BCH, the far chain, the conversion). */
  txids: number;
}

const isOut = (r: Run): boolean => r.flow.endsWith('out');

/** BCH-side tokens of config `tokens` named in a run amount (not the part after CHAIN.). */
function bchTokens(cfg: BountyConfig, amount: string): string[] {
  return Object.keys(cfg.tokens).filter((t) => new RegExp(`(?<![.\\w])${t}\\b`).test(amount));
}

/** The ok crossings: flows as in the crossings table, result `ok`. */
export function okCrossings(cfg: BountyConfig, measured: string): Run[] {
  const flows = new Set(crossingFlows(cfg));
  return parseRuns(measured).filter((r) => flows.has(r.flow) && r.result.toLowerCase() === 'ok');
}

export function countStats(cfg: BountyConfig, measured: string): Stats {
  const runs = okCrossings(cfg, measured);
  const ways = new Map<string, Set<string>>();
  const symbols = new Set<string>();
  const stables = new Set<string>();
  for (const r of runs) {
    const m = /\b([A-Z]+)\.([A-Z]+)\b/.exec(r.amount);
    if (!m) throw new Error(`MEASURED ${r.utc}: no CHAIN.ASSET in "${r.amount}"`);
    const name = cfg.evm.chains.find((c) => c.key.toUpperCase() === m[1])?.name;
    if (!name) throw new Error(`MEASURED ${r.utc}: chain ${m[1]} not in evm.chains`);
    if (!ways.has(name)) ways.set(name, new Set());
    ways.get(name)?.add(isOut(r) ? 'out' : 'in');
    symbols.add(m[2] ?? '');
    for (const t of bchTokens(cfg, r.amount)) stables.add(t);
  }
  const order = cfg.evm.chains.map((c) => c.name).filter((n) => ways.has(n));
  return {
    crossings: runs.length,
    inCount: runs.filter((r) => !isOut(r)).length,
    outStable: runs.filter((r) => isOut(r) && bchTokens(cfg, r.amount).length > 0).length,
    thorchain: runs.filter((r) => !r.flow.startsWith('oc-')).length,
    pusd: runs.filter((r) => bchTokens(cfg, r.amount).includes('PUSD')).length,
    chains: order,
    symbols: [...symbols].sort(),
    bothWays: order.filter((n) => ways.get(n)?.size === 2),
    bchStables: [...stables].sort(),
    txids: new Set(runs.flatMap((r) => legs(r.txid).map(([, tx]) => tx.toLowerCase()))).size,
  };
}

const atLeast = (n: number, met: number, partly = met): Status => (n >= met ? 'met' : n >= partly ? 'partly' : 'open');

/** The status of a row: counted when it has a rule, as written otherwise. */
export function rowStatus(row: Row, s: Stats): Status {
  switch (row.rule) {
    case undefined: {
      if (!row.status) throw new Error(`bounty row without status or rule: ${row.quote.slice(0, 40)}`);
      return row.status;
    }
    case 'bothDirections': return s.inCount > 0 && s.outStable > 0 ? 'met' : s.inCount + s.outStable > 0 ? 'partly' : 'open';
    case 'in': return atLeast(s.inCount, 1);
    case 'out': return atLeast(s.outStable, 1);
    case 'chains': return atLeast(s.chains.length, 2, 1);
    case 'bchStables': return atLeast(s.bchStables.length, 2);
    case 'thorchain': return atLeast(s.thorchain, 1);
    case 'pusd': return atLeast(s.pusd, 1);
    default: throw new Error(`unknown bounty rule "${row.rule}"`);
  }
}

/** The bounty file with each counted status written in, as `--write` saves it (the file shows every status). */
export function withCountedStatus(b: Bounty, s: Stats): Bounty {
  return { ...b, rows: b.rows.map((r) => (r.rule ? { ...r, status: rowStatus(r, s) } : r)) };
}

function list(items: string[], and: string): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')}${and}${items[items.length - 1]}`;
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (all, k: string) => {
    if (!(k in vars)) throw new Error(`bounty text: unknown placeholder ${all}`);
    return String(vars[k]);
  });
}

interface Link { text: string; href: string; code?: string }

/** One proof as a link, relative to the file that holds the block. */
function proofLink(p: Proof, lang: Lang, from: string, cfg: BountyConfig, runs: Run[]): Link {
  const text = p.label[lang];
  if (p.kind === 'url') return { text, href: p.ref };
  if (p.kind === 'file') {
    const [path = '', anchor] = p.ref.split('#');
    const rel = posix.relative(posix.dirname(from), path);
    return { text, href: `${rel}${anchor ? `#${anchor}` : ''}` };
  }
  const run = [...runs].reverse().find((r) => (!p.flows || p.flows.includes(r.flow)) && r.amount.includes(p.ref));
  const bch = run ? legs(run.txid).find(([l]) => l === 'bch') : undefined;
  if (!run || !bch) throw new Error(`bounty proof: no ok crossing with "${p.ref}" in ${MEASURED}`);
  return { text, href: cfg.connect.explorerTxUrl.replace('{txid}', bch[1]), code: `bch ${bch[1].slice(0, 8)}` };
}

const md = (l: Link): string => `[${l.text}${l.code ? ` \`${l.code}\`` : ''}](${l.href})`;
const htmlLink = (l: Link): string => `<a href="${l.href}">${l.text}${l.code ? ` <code>${l.code}</code>` : ''}</a>`;
/** Markdown links and code spans of the JSON texts as HTML. */
const toHtml = (s: string): string => s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>').replace(/`([^`]+)`/g, '<code>$1</code>');

const cell = (s: string): string => {
  if (s.includes('|')) throw new Error(`bounty text with a "|": ${s.slice(0, 40)}`);
  return s;
};

/** The block (markers included) for one file. */
export function bountyBlock(b: Bounty, cfg: BountyConfig, measured: string, target: Target): string {
  const { lang, path } = target;
  const s = countStats(cfg, measured);
  const runs = okCrossings(cfg, measured);
  const and = b.joinWord[lang];
  const vars = {
    bounty: b.bounty, source: b.source, readDate: b.readUtc.slice(0, 10),
    measured: posix.relative(posix.dirname(path), MEASURED),
    crossings: s.crossings, chains: s.chains.length, chainNames: list(s.chains, and), symbols: list(s.symbols, and),
    bothWays: list(s.bothWays, and), bchStables: list(s.bchStables, and), thorchain: s.thorchain, pusd: s.pusd,
  };
  const cols = b.columns[lang];
  const rows = b.rows.map((r) => ({
    quote: cell(r.quote), section: cell(r.section), status: b.statusLabels[lang][rowStatus(r, s)],
    note: cell(fill(r.note[lang], vars)), proofs: r.proof.map((p) => proofLink(p, lang, path, cfg, runs)),
  }));
  if (target.html) {
    const head = `<tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>`;
    const body = rows.map((r) => `<tr><td>${r.quote} <sub>${r.section}</sub></td><td><b>${r.status}.</b> ${toHtml(r.note)}</td>`
      + `<td>${r.proofs.map(htmlLink).join(' · ')}</td></tr>`).join('');
    return `${START}<p><b>${toHtml(fill(b.headline[lang], vars))}</b> ${toHtml(fill(b.intro[lang], vars))}</p><table>${head}${body}</table>\n${END}`;
  }
  const lines = [
    START,
    fill(b.intro[lang], vars),
    '',
    `**${fill(b.headline[lang], vars)}**`,
    '',
    `| ${cols.join(' | ')} |`,
    `|${cols.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.quote} <sub>${r.section}</sub> | **${r.status}.** ${r.note} | ${r.proofs.map(md).join(' · ')} |`),
    END,
  ];
  return lines.join('\n');
}

/** `text` with its bounty block replaced by `block`. */
export function replaceBlock(text: string, block: string): string {
  const a = text.indexOf(START);
  const z = text.indexOf(END);
  if (a < 0 || z < a) throw new Error('bounty markers missing');
  return `${text.slice(0, a)}${block}${text.slice(z + END.length)}`;
}

/** The block currently in `text`, markers included. */
export function currentBlock(text: string): string {
  const a = text.indexOf(START);
  const z = text.indexOf(END);
  if (a < 0 || z < a) throw new Error('bounty markers missing');
  return text.slice(a, z + END.length);
}

export const repoFile = (p: string): string => file(`../${p}`);

export function load(): { b: Bounty; cfg: BountyConfig; measured: string } {
  return {
    b: JSON.parse(readFileSync(repoFile(BOUNTY_FILE), 'utf8')) as Bounty,
    cfg: JSON.parse(readFileSync(repoFile('config/sampan.json'), 'utf8')) as BountyConfig,
    measured: readFileSync(repoFile(MEASURED), 'utf8'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { b, cfg, measured } = load();
  if (process.argv.includes('--write')) {
    const counted = withCountedStatus(b, countStats(cfg, measured));
    writeFileSync(repoFile(BOUNTY_FILE), `${JSON.stringify(counted, null, 2)}\n`);
    for (const t of TARGETS) {
      const f = repoFile(t.path);
      writeFileSync(f, replaceBlock(readFileSync(f, 'utf8'), bountyBlock(b, cfg, measured, t)));
    }
  } else process.stdout.write(`${bountyBlock(b, cfg, measured, TARGETS[0] ?? { path: 'README.md', lang: 'en' })}\n`);
}
