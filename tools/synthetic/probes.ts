// Probes of the synthetic monitor. Each answers {probe, ok, ms, detail} and never throws. The site probes go
// through the public URL like a visitor; the provider probes ask every configured provider directly, and fail
// only when none of them answers (one provider down is named in `detail`, nothing more). Read-only: the landing
// probe opens an address for the test wallet (counted as test, never public) and pays nothing.
import type { SampanConfig } from '../../core/config.js';
import { parseAddress, tokenAddressOf } from '../../core/address.js';
import { landingAddress } from '../../core/landing.js';
import { prefixOf, readCard } from '../../core/landing-card.js';
import { chainsOf, liveAssets, openMapOf, type InboundRow, type OpenMap } from '../../core/route-assets.js';
import type { ProbeResult } from './alerts.js';

export interface ProbeDeps {
  fetch: typeof fetch;
  /** Tip height from one Electrum server. */
  tipHeight: (server: string) => Promise<number>;
  /** Active pools for a token category from one Cauldron indexer. */
  activePools: (indexer: string, category: string) => Promise<number>;
  /** THORNode inbound_addresses rows from one node. */
  inbound: (node: string) => Promise<InboundRow[]>;
  timeoutMs: number;
}

export interface ProbeContext {
  url: string;
  config: SampanConfig;
  deps: ProbeDeps;
}

type Check = (c: ProbeContext) => Promise<string>;

const short = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 160);

async function timed(probe: string, check: Check, c: ProbeContext): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const detail = await check(c);
    return { probe, ok: true, ms: Date.now() - t0, detail };
  } catch (e) {
    return { probe, ok: false, ms: Date.now() - t0, detail: short(e) };
  }
}

async function get(c: ProbeContext, path: string): Promise<Response> {
  const res = await c.deps.fetch(new URL(path, c.url), { signal: AbortSignal.timeout(c.deps.timeoutMs), headers: { 'user-agent': 'sampan-synthetic' } });
  if (res.status !== 200) throw new Error(`${path} answered ${res.status}`);
  return res;
}

async function getJson<T>(c: ProbeContext, path: string): Promise<T> {
  const res = await get(c, path);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`${path} is not JSON`);
  }
}

async function postJson<T>(c: ProbeContext, path: string, body: unknown): Promise<T> {
  const res = await c.deps.fetch(new URL(path, c.url), {
    method: 'POST',
    signal: AbortSignal.timeout(c.deps.timeoutMs),
    headers: { 'content-type': 'application/json', origin: new URL(c.url).origin, 'user-agent': 'sampan-synthetic' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${path} answered ${res.status} ${text.slice(0, 80)}`);
  return JSON.parse(text) as T;
}

interface PublicConfig {
  features?: { landing?: boolean };
  compliance?: { crossChainEnabled?: boolean };
}

const crossOpen = (c: ProbeContext): boolean => c.config.compliance.crossChainEnabled;

/** GET / is 200 with a CSP header, and every script and stylesheet it names answers 200. */
const page: Check = async (c) => {
  const res = await get(c, '/');
  if (!res.headers.get('content-security-policy')) throw new Error('no content-security-policy header');
  const html = await res.text();
  const assets = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="stylesheet"[^>]*\shref)="([^"]+)"/g)].map((m) => m[1]!);
  if (!assets.some((a) => a.endsWith('.js'))) throw new Error('page names no script');
  for (const a of assets) await get(c, a);
  return `${assets.length} assets`;
};

const config: Check = async (c) => {
  const body = await getJson<PublicConfig>(c, '/api/config');
  if (!body || typeof body !== 'object' || !body.features) throw new Error('/api/config has no features');
  return 'ok';
};

const health: Check = async (c) => {
  const h = await getJson<{ cauldron: boolean | null; bch: boolean | null; route: { open: boolean | null } | null }>(c, '/api/health');
  const down = [h.cauldron !== true && 'cauldron', h.bch !== true && 'bch', crossOpen(c) && h.route?.open !== true && 'route'].filter(Boolean);
  if (down.length) throw new Error(`down: ${down.join(', ')}`);
  return 'cauldron, bch up';
};

const quote: Check = async (c) => {
  const token = c.config.tokens[c.config.defaultToken]!;
  const q = await postJson<{ quote?: { usd: number } }>(c, '/api/swap/quote', { token: token.symbol, side: 'buy', amount: '100000' });
  if (!q.quote || !(q.quote.usd > 0)) throw new Error('quote has no price');
  return `0.001 BCH = USD ${q.quote.usd.toFixed(2)}`;
};

/** The test wallet's own address, token form: counted as test by the server, never public. */
export function landingOwner(config: SampanConfig): string {
  const prefix = prefixOf('mainnet');
  const first = config.ops.testAddresses.find((a) => a.startsWith(`${prefix}:`));
  if (!first) throw new Error('config.ops.testAddresses has no address for this network');
  const parsed = parseAddress(first, prefix);
  if (typeof parsed === 'string') throw new Error(parsed);
  return tokenAddressOf(parsed.lockingHex, prefix);
}

const landing: Check = async (c) => {
  const pub = await getJson<PublicConfig>(c, '/api/config');
  if (!pub.features?.landing) return 'landing closed, not checked';
  const token = c.config.tokens[c.config.defaultToken]!;
  const opened = await postJson<{ card: unknown }>(c, '/api/land/open', { ownerAddress: landingOwner(c.config), token: token.symbol });
  const read = readCard(opened.card);
  if (typeof read === 'string') throw new Error(`card refused: ${read}`);
  const again = landingAddress(read.params, prefixOf(read.card.network));
  if (again !== read.card.address) throw new Error('card address differs from the address computed from its parameters');
  return 'address recomputed from the card';
};

/** Fails only when every provider fails; the ones that failed are named in the detail. */
async function anyProvider<T>(names: string[], ask: (n: string) => Promise<T>, good: (v: T) => boolean, label: (v: T) => string): Promise<string> {
  const answers = await Promise.all(names.map((n) => ask(n).then((v) => ({ n, v, e: '' }), (e: unknown) => ({ n, v: undefined, e: short(e) }))));
  const ok = answers.filter((a) => a.v !== undefined && good(a.v));
  const bad = answers.filter((a) => !ok.includes(a)).map((a) => `${new URL(a.n).host}${a.e ? ` (${a.e})` : ''}`);
  if (!ok.length) throw new Error(`none answered: ${bad.join('; ')}`);
  return `${ok.length}/${names.length} up, ${label(ok[0]!.v as T)}${bad.length ? `; down: ${bad.join('; ')}` : ''}`;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms).unref())]);

const indexer: Check = async (c) => {
  const category = c.config.tokens[c.config.defaultToken]!.category;
  return anyProvider(c.config.cauldron.indexers, (n) => withTimeout(c.deps.activePools(n, category), c.deps.timeoutMs), (v) => v >= 1, (v) => `${v} pools`);
};

const electrum: Check = async (c) => {
  return anyProvider(c.config.electrum.servers, (n) => withTimeout(c.deps.tipHeight(n), c.deps.timeoutMs), (v) => v > 0, (v) => `height ${v}`);
};

// Fails only when BCH is closed or every live asset's chain is; one closed chain is detail, not an alert (KMR2).
const thornode: Check = async (c) => {
  const chains = chainsOf(liveAssets(c.config.thorchain.assets));
  const closed = (m: OpenMap) => chains.filter((ch) => m[ch] !== true);
  const good = (rows: InboundRow[]) => {
    const m = openMapOf(rows);
    return m['BCH'] === true && (chains.length === 0 || closed(m).length < chains.length);
  };
  const label = (rows: InboundRow[]) => {
    const shut = closed(openMapOf(rows));
    return `BCH open, ${chains.length - shut.length}/${chains.length} live chains open${shut.length ? `; closed: ${shut.join(', ')}` : ''}`;
  };
  try {
    return await anyProvider(c.config.thorchain.nodes, (n) => withTimeout(c.deps.inbound(n), c.deps.timeoutMs), good, label);
  } catch (e) {
    if (!crossOpen(c)) return `crossings closed; ${short(e)}`;
    throw e;
  }
};

export const HOURLY: Record<string, Check> = { page, config, health, quote, landing, indexer, electrum, thornode };

export async function runProbes(c: ProbeContext, names: string[] = Object.keys(HOURLY)): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (const n of names) {
    const check = HOURLY[n];
    if (!check) throw new Error(`unknown probe ${n}`);
    out.push(await timed(n, check, c));
  }
  return out;
}
