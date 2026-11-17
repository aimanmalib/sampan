// Failover, measured: the built server (dist/) on this host against the real providers, with one provider at a time
// replaced by an address that refuses the connection or never answers. Reads only: no transaction is built or sent.
//   npx tsx tools/measure/failover.ts --to 0x<test wallet on Base> [--only a-refused,b] [--port 4186] [--shots dir] [--write]
// Cases: base (shipped config), a-* (first Electrum server broken), b (every Electrum server broken), c (every
// Cauldron indexer broken), d-* (first THORNode broken; crossings opened for this local server only). For b and c the
// page is opened in WebKit (iPhone 13) and screenshots go to --shots (default state/failover/, not tracked).
// Run it through the host's browser queue. --write replaces the Failover section of docs/MEASURED.md.
import { execSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { devices, webkit } from '@playwright/test';
import { withLive, type RouteAsset } from '../../core/route-assets.js';
import { REFUSED_HOST, SILENT_HOST, healthWords, writeFailoverSection, type CaseOutcome, type FailoverRow } from './failover-table.js';
import { startServer, waitHealthy } from './server.js';

const arg = (name: string, fallback = ''): string => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const PORT = Number(arg('--port', '4186'));
const BASE = `http://127.0.0.1:${PORT}`;
const TO = arg('--to');
const ONLY = arg('--only').split(',').filter(Boolean);
const SHOTS = arg('--shots', 'state/failover');

interface Shipped {
  electrum: { servers: string[] };
  cauldron: { indexers: string[] };
  thorchain: { nodes: string[]; assets: RouteAsset[] };
  tokens: Record<string, { symbol: string }>;
  defaultToken: string;
  ops: { testAddresses: string[] };
}
const shipped = JSON.parse(readFileSync('config/sampan.json', 'utf8')) as Shipped;
/** The route cases quote the first listed asset, switched live on this local server only. */
const probeAsset = shipped.thorchain.assets[0]!;
const cross = { compliance: { crossChainEnabled: true }, thorchain: { assets: withLive(shipped.thorchain.assets, [probeAsset.asset]) } };

interface Case {
  id: string;
  broken: string;
  patch: Record<string, unknown>;
  route?: boolean;
  page?: boolean;
}
const CASES: Case[] = [
  { id: 'base', broken: 'nothing', patch: {} },
  { id: 'a-refused', broken: 'first Electrum server refuses', patch: { electrum: { servers: [`ws://${REFUSED_HOST}`, ...shipped.electrum.servers] } } },
  { id: 'a-silent', broken: 'first Electrum server never answers', patch: { electrum: { servers: [`wss://${SILENT_HOST}:50004`, ...shipped.electrum.servers] } } },
  { id: 'b', broken: 'every Electrum server down (two refuse, one never answers)', patch: { electrum: { servers: [`ws://${REFUSED_HOST}`, 'ws://127.0.0.2:9', `wss://${SILENT_HOST}:50004`] } }, page: true },
  { id: 'c', broken: 'every Cauldron indexer down (refuses)', patch: { cauldron: { indexers: [`https://${REFUSED_HOST}`] } }, page: true },
  { id: 'd-base', broken: 'nothing; crossings open', patch: cross, route: true },
  { id: 'd-refused', broken: 'first THORNode refuses; crossings open', patch: { ...cross, thorchain: { nodes: [`https://${REFUSED_HOST}`, ...shipped.thorchain.nodes] } }, route: true },
  { id: 'd-silent', broken: 'first THORNode never answers; crossings open', patch: { ...cross, thorchain: { nodes: [`https://${SILENT_HOST}`, ...shipped.thorchain.nodes] } }, route: true },
];

async function timed(pathname: string, body: unknown): Promise<CaseOutcome> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return { status: res.status, ms: performance.now() - t0, ...(json.error ? { error: json.error } : {}) };
  } catch {
    return { status: 0, ms: performance.now() - t0 };
  }
}

interface Health { checkedAt: number | null; cauldron: boolean | null; bch: boolean | null; route: { open: boolean | null } | null }
async function firstHealth(): Promise<Health> {
  for (let i = 0; i < 240; i++) {
    const h = (await fetch(`${BASE}/api/health`).then((r) => r.json(), () => null)) as Health | null;
    if (h?.checkedAt) return h;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no health report within 60 s');
}

async function pageView(id: string): Promise<string> {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await webkit.launch();
  try {
    const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '');
    await page.screenshot({ path: path.join(SHOTS, `${stamp}-failover-${id}-webkit-iphone13.png`), fullPage: true });
    const notes = await page.locator('.provider-note, .health, [role=alert]').allInnerTexts();
    return notes.map((t) => t.trim()).filter(Boolean).join(' / ') || 'no provider note';
  } finally {
    await browser.close();
  }
}

async function runCase(c: Case, commit: string): Promise<FailoverRow> {
  const dataDir = path.resolve(`state/failover/data-${c.id}`);
  const t0 = performance.now();
  const server: ChildProcess = startServer({ port: PORT, dataDir, patch: c.patch });
  const exited = new Promise<never>((_, reject) => server.once('exit', (code) => reject(new Error(`server for case ${c.id} exited (${code})`))));
  try {
    await Promise.race([waitHealthy(BASE), exited]);
    const h = await firstHealth();
    const firstHealthS = (performance.now() - t0) / 1000;
    const token = shipped.tokens[shipped.defaultToken]!.symbol;
    const quote = await timed('/api/swap/quote', { token, side: 'buy', amount: '100000' });
    const scan = await timed('/api/wallet/scan', { paths: { receive: shipped.ops.testAddresses.slice(0, 1) } });
    const route = c.route ? await timed('/api/out/quote', { source: 'BCH', amount: '400000', symbol: probeAsset.symbol, chain: probeAsset.chain, destination: TO }) : undefined;
    const page = c.page ? await pageView(c.id) : 'not opened';
    return { at: new Date().toISOString().slice(0, 19) + 'Z', id: c.id, broken: c.broken, firstHealthS, health: healthWords(h), quote, scan, ...(route ? { route } : {}), page, commit };
  } finally {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await exited.catch(() => undefined);
    }
  }
}

async function main(): Promise<void> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(TO)) throw new Error('--to 0x<address> is needed for the route quote');
  const commit = execSync('git rev-parse --short HEAD').toString().trim();
  const rows: FailoverRow[] = [];
  for (const c of CASES.filter((x) => ONLY.length === 0 || ONLY.includes(x.id))) {
    const row = await runCase(c, commit);
    console.log(JSON.stringify(row));
    rows.push(row);
  }
  if (process.argv.includes('--write')) {
    writeFileSync('docs/MEASURED.md', writeFailoverSection(readFileSync('docs/MEASURED.md', 'utf8'), rows));
    console.log(`docs/MEASURED.md: Failover section has ${rows.length} rows`);
  }
}

await main();
