// Handlers behind the Sampan MCP server: a thin client of the public Sampan API. Each handler takes its fetch and
// base URL from the caller, so tests run without a network. Nothing here holds a key or signs: every payment is
// made by the user's own wallet. The landing address is checked here the same way the web page checks it: it is
// recomputed from the recovery card and refused when it differs or pays someone else.
import { cardToFragment } from '../core/landing-card.js';
import { landingLockingHex } from '../core/landing.js';
import { acceptCard, LandingMismatch } from '../core/client/land.js';
import { formatUnits, parseUnits } from '../core/wallet.js';

const BCH_DECIMALS = 8;
const ID = /^[0-9a-f]{32}$/;

export interface Deps {
  /** Site root without a trailing slash, e.g. https://sampan.sasateguh.com */
  base: string;
  fetch: typeof fetch;
}

/** The part of GET /api/config these tools read. */
export interface SiteConfig {
  tokens: Record<string, { symbol: string; category: string; decimals: number }>;
  defaultToken: string;
  features: { swap: boolean; landing: boolean; pay: boolean };
  landing: { returnAfterBlocks: number };
}

/** A failure the agent should see as a tool error (bad input, a refusal from the API, a card that does not check). */
export class ToolFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolFailure';
  }
}

/** SAMPAN_URL when set, else the site URL from config. Only http(s); no trailing slash. */
export function baseUrl(fromEnv: string | undefined, fromConfig: string): string {
  const raw = fromEnv && fromEnv.trim() !== '' ? fromEnv.trim() : fromConfig;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`not a URL: ${raw}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`the Sampan URL must be http or https: ${raw}`);
  return u.origin + u.pathname.replace(/\/+$/, '');
}

async function call<T>(d: Deps, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { accept: 'application/json' } };
  if (body !== undefined) {
    init.headers = { accept: 'application/json', 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await d.fetch(`${d.base}${path}`, init);
  } catch (e) {
    throw new ToolFailure(`Sampan did not answer at ${d.base}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ToolFailure(`Sampan answered ${res.status} without JSON`);
  }
  if (!res.ok) {
    const e = json as { error?: string; message?: string };
    throw new ToolFailure(`Sampan refused (${res.status} ${e.error ?? 'error'}): ${e.message ?? 'no reason given'}`);
  }
  return json as T;
}

export const readSiteConfig = (d: Deps): Promise<SiteConfig> => call<SiteConfig>(d, 'GET', '/api/config');

function tokenOf(cfg: SiteConfig, symbol: string | undefined): SiteConfig['tokens'][string] {
  const name = (symbol ?? cfg.defaultToken).toUpperCase();
  const t = cfg.tokens[name];
  if (!t) throw new ToolFailure(`unknown token ${name}; Sampan offers ${Object.keys(cfg.tokens).join(', ')}`);
  return t;
}

export interface QuoteInput {
  side: 'buy' | 'sell';
  /** Decimal amount of what the user pays: BCH for buy, the token for sell. */
  amount: string;
  token?: string | undefined;
}

interface WireQuote {
  token: string;
  side: 'buy' | 'sell';
  supply: string;
  demand: string;
  minReceive: string;
  sampanFeeSats: string;
  pools: number;
  usd: number;
}

export async function quoteSwap(d: Deps, cfg: SiteConfig, i: QuoteInput) {
  const t = tokenOf(cfg, i.token);
  const payDecimals = i.side === 'buy' ? BCH_DECIMALS : t.decimals;
  const getDecimals = i.side === 'buy' ? t.decimals : BCH_DECIMALS;
  const units = parseUnits(i.amount, payDecimals);
  if (units === undefined || units <= 0n) throw new ToolFailure(`amount must be a positive decimal with at most ${payDecimals} decimals`);
  const { quote: q } = await call<{ quote: WireQuote }>(d, 'POST', '/api/swap/quote', { token: t.symbol, side: i.side, amount: units.toString() });
  const payUnit = i.side === 'buy' ? 'BCH' : t.symbol;
  const getUnit = i.side === 'buy' ? t.symbol : 'BCH';
  return {
    token: t.symbol,
    side: i.side,
    pay: { amount: formatUnits(BigInt(q.supply), payDecimals), unit: payUnit },
    receive: { amount: formatUnits(BigInt(q.demand), getDecimals), atLeast: formatUnits(BigInt(q.minReceive), getDecimals), unit: getUnit },
    sampanFeeBch: formatUnits(BigInt(q.sampanFeeSats), BCH_DECIMALS),
    pools: q.pools,
    usd: q.usd,
    note: 'A quote only. To swap, open the Sampan site and sign in your own wallet.',
  };
}

export interface LandingInput {
  ownerAddress: string;
  token?: string | undefined;
}

interface OpenReply {
  crossingId: string;
  card: unknown;
  minSats: string;
  tokensMin: string;
  validHours: number;
}

export async function createLandingAddress(d: Deps, cfg: SiteConfig, i: LandingInput) {
  const t = tokenOf(cfg, i.token);
  const prefix = i.ownerAddress.trim().toLowerCase().startsWith('bchtest:') ? 'bchtest' : 'bitcoincash';
  const reply = await call<OpenReply>(d, 'POST', '/api/land/open', { ownerAddress: i.ownerAddress.trim(), token: t.symbol });
  let checked;
  try {
    checked = acceptCard(reply.card, { ownerAddress: i.ownerAddress.trim(), token: t.symbol, category: t.category, returnAfter: cfg.landing.returnAfterBlocks, prefix });
  } catch (e) {
    if (e instanceof LandingMismatch) throw new ToolFailure(`refused the address Sampan sent: ${e.message}`);
    throw e;
  }
  const { card, params } = checked;
  if ((card.network === 'mainnet') !== (prefix === 'bitcoincash')) throw new ToolFailure('refused the address Sampan sent: the card is for another network');
  if (typeof reply.crossingId !== 'string' || !ID.test(reply.crossingId)) throw new ToolFailure('Sampan sent a malformed crossing id');
  return {
    crossingId: reply.crossingId,
    address: card.address,
    paymentUri: card.address,
    lockingBytecode: landingLockingHex(params),
    token: t.symbol,
    minimumBch: formatUnits(BigInt(reply.minSats), BCH_DECIMALS),
    tokensAtLeastForMinimum: formatUnits(BigInt(reply.tokensMin), t.decimals),
    validHours: reply.validHours,
    statusUrl: `${d.base}/c/${reply.crossingId}#card=${cardToFragment(card)}`,
    card,
    checked: 'The address was recomputed here from the card and pays the owner address given.',
    note: 'Send BCH to this address from any wallet. Keep the card: with it anyone can finish the landing without the Sampan server.',
  };
}

export async function getCrossingStatus(d: Deps, i: { id: string }) {
  if (!ID.test(i.id)) throw new ToolFailure('id must be 32 lowercase hex characters');
  return call<Record<string, unknown>>(d, 'GET', `/api/crossings/${i.id}`);
}

export interface InvoiceInput {
  usd: number;
  merchantAddress: string;
  orderId?: string | undefined;
  returnUrl?: string | undefined;
}

export async function createInvoice(d: Deps, i: InvoiceInput) {
  const body: Record<string, unknown> = { usd: i.usd, merchantAddress: i.merchantAddress.trim() };
  if (i.orderId !== undefined) body.orderId = i.orderId;
  if (i.returnUrl !== undefined) body.returnUrl = i.returnUrl;
  const r = await call<{ id: string; address: string; bip21: string; statusUrl: string; usd: string; requiredSats: string; expiresAt: string }>(
    d,
    'POST',
    '/api/pay/invoice',
    body,
  );
  if (r.bip21.split('?')[0]?.toLowerCase() !== r.address.toLowerCase()) throw new ToolFailure('Sampan sent an invoice whose payment link and address differ');
  return {
    id: r.id,
    address: r.address,
    paymentUri: r.bip21,
    usd: r.usd,
    bch: formatUnits(BigInt(r.requiredSats), BCH_DECIMALS),
    expiresAt: r.expiresAt,
    statusUrl: r.statusUrl,
  };
}
