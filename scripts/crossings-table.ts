// The mainnet crossings table in README.md and README.ms.md, made from the Runs table of docs/MEASURED.md and the
// explorers in config/sampan.json. Rows: every `out` and `in` run (THORChain), failed ones included, and the `oc-out` /
// `oc-in` runs (1Click) only in a direction where at least one oneClick asset is live. Each leg of a crossing is a link:
// bch and convert to connect.explorerTxUrl, an EVM leg to evm.chains[].explorer + /tx/, and the THORChain trace to
// thorchain.explorerTxUrl (inbound leg). No host is written here.
// Each README keeps its own header row (its language) as the first two lines of the block; this script writes the rows.
//   npm run crossings              print the rows
//   npm run crossings -- --write   rewrite the block in both READMEs
// tests/crossings-table.test.ts fails when a README and docs/MEASURED.md disagree.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const file = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
export const README_FILES = [file('../README.md'), file('../README.ms.md')];
const MEASURED_FILE = file('../docs/MEASURED.md');
const CONFIG_FILE = file('../config/sampan.json');
export const START = '<!-- crossings:start (made by scripts/crossings-table.ts from docs/MEASURED.md) -->';
export const END = '<!-- crossings:end -->';

export interface CrossingsConfig {
  connect: { explorerTxUrl: string };
  thorchain?: { explorerTxUrl?: string };
  evm: { chains: ReadonlyArray<{ key: string; name: string; explorer: string }> };
  oneClick?: { assets?: ReadonlyArray<{ live?: { out?: boolean; in?: boolean } }> };
}

export interface Run {
  utc: string;
  flow: string;
  amount: string;
  txid: string;
  seconds: string;
  result: string;
}

/** The rows of the `## Runs` table in MEASURED.md. */
export function parseRuns(measured: string): Run[] {
  const section = measured.split('## Runs', 2)[1]?.split('\n## ', 1)[0] ?? '';
  const runs: Run[] = [];
  for (const line of section.split('\n')) {
    const c = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
    const [utc = '', flow = '', amount = '', txid = '', seconds = ''] = c;
    if (c.length < 6 || !/^\d{4}-\d\d-\d\dT/.test(utc)) continue;
    runs.push({ utc, flow, amount, txid, seconds, result: c[c.length - 1] ?? '' });
  }
  return runs;
}

/** The flows the table shows: THORChain always, 1Click only in a direction with a live asset. */
export function crossingFlows(cfg: CrossingsConfig): string[] {
  const assets = cfg.oneClick?.assets ?? [];
  const flows = ['out', 'in'];
  for (const dir of ['out', 'in'] as const) if (assets.some((a) => a.live?.[dir] === true)) flows.push(`oc-${dir}`);
  return flows;
}

const HEX = /^(0x)?[0-9a-fA-F]{64}$/;

/** One leg as a markdown link, or null when the chain has no explorer in config. */
function legLink(cfg: CrossingsConfig, label: string, txid: string): string | null {
  if (!HEX.test(txid)) return null;
  const bare = txid.replace(/^0x/i, '');
  const key = label.toUpperCase();
  let url: string | null = null;
  if (key === 'BCH' || key === 'CONVERT') url = cfg.connect.explorerTxUrl.replace('{txid}', bare);
  else {
    const chain = cfg.evm.chains.find((ch) => ch.key.toUpperCase() === key);
    if (chain) url = `${chain.explorer}/tx/0x${bare}`;
  }
  return url ? `[\`${label} ${txid.slice(0, txid.startsWith('0x') ? 10 : 8)}\`](${url})` : null;
}

/** `bch <hex> · eth 0x<hex> · convert <hex>` as [label, txid] pairs. */
export function legs(txid: string): Array<[string, string]> {
  return [...txid.matchAll(/\b([a-z]+) ((?:0x)?[0-9a-fA-F]{64})\b/g)].map((m): [string, string] => [m[1] ?? '', m[2] ?? '']);
}

/** One table row for a crossing run. Throws when a leg has no explorer, so a new chain cannot slip in unlinked. */
export function crossingRow(cfg: CrossingsConfig, run: Run): string {
  const asset = /\b([A-Z]+)\.([A-Z]+)\b/.exec(run.amount);
  if (!asset) throw new Error(`MEASURED ${run.utc}: no CHAIN.ASSET in "${run.amount}"`);
  const [, chainKey = '', symbol = ''] = asset;
  const chain = cfg.evm.chains.find((ch) => ch.key.toUpperCase() === chainKey);
  if (!chain) throw new Error(`MEASURED ${run.utc}: chain ${chainKey} not in evm.chains`);
  const out = run.flow.endsWith('out');
  const route = run.flow.startsWith('oc-') ? '1Click' : 'THORChain';
  const sent = /^([\d.]+) ([A-Z]+)(?:\.([A-Z]+))?/.exec(run.amount);
  const sentText = sent ? `${sent[1]} ${sent[3] ?? sent[2]}` : run.amount;
  const pairs = legs(run.txid);
  const links = pairs.map(([label, tx]) => {
    const link = legLink(cfg, label, tx);
    if (!link) throw new Error(`MEASURED ${run.utc}: no explorer for leg "${label}"`);
    return link;
  });
  const trace = cfg.thorchain?.explorerTxUrl;
  const inbound = pairs.find(([label]) => (out ? label === 'bch' : label === chainKey.toLowerCase()));
  if (route === 'THORChain' && trace && inbound) {
    links.push(`[THORChain](${trace.replace('{txid}', inbound[1].replace(/^0x/i, ''))})`);
  }
  const when = `${run.utc.slice(5, 10)} ${run.utc.slice(11, 16)}`;
  const way = out ? `BCH → ${chain.name}` : `${chain.name} → BCH`;
  return `| ${when} | ${route} | ${way} | ${symbol} | ${sentText} | ${run.seconds} | ${run.result} | ${links.join(' · ') || '-'} |`;
}

export function crossingRows(cfg: CrossingsConfig, measured: string): string[] {
  const flows = new Set(crossingFlows(cfg));
  return parseRuns(measured).filter((r) => flows.has(r.flow)).map((r) => crossingRow(cfg, r));
}

/** `readme` with its block's rows replaced by `rows`; the header row and separator inside the block stay. */
export function replaceRows(readme: string, rows: string[]): string {
  const a = readme.indexOf(START);
  const z = readme.indexOf(END);
  if (a < 0 || z < a) throw new Error('README: crossings markers missing');
  const inner = readme.slice(a + START.length, z).split('\n').filter((l) => l.startsWith('|'));
  const [header, rule] = inner;
  if (header === undefined || rule === undefined || !/^\|\s*-/.test(rule)) throw new Error('README: the crossings block needs its header row and separator');
  return `${readme.slice(0, a)}${[START, header, rule, ...rows, END].join('\n')}${readme.slice(z + END.length)}`;
}

export function load(): { cfg: CrossingsConfig; measured: string } {
  return { cfg: JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as CrossingsConfig, measured: readFileSync(MEASURED_FILE, 'utf8') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { cfg, measured } = load();
  const rows = crossingRows(cfg, measured);
  if (process.argv.includes('--write')) {
    for (const f of README_FILES) writeFileSync(f, replaceRows(readFileSync(f, 'utf8'), rows));
  } else process.stdout.write(`${rows.join('\n')}\n`);
}
