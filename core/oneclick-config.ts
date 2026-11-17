// The oneClick block of config/sampan.json: the NEAR Intents 1Click API as a second route next to THORChain (ADR 0048,
// ADR 0049). Pure. Only the server calls the API; route.active stays thorchain and features.oneClick shows the route.
import type { Direction } from './route-assets.js';

export interface OneClickAsset {
  /** 1Click asset id exactly as GET /v0/tokens names it. */
  id: string;
  /** Key of the evm.chains entry (the same key the THORChain asset uses). */
  chain: string;
  symbol: string;
  /** Decimals of the token as 1Click counts it (the same as on its chain). */
  decimals: number;
  /** Offered in a direction only after two measured mainnet runs through the page (docs/MEASURED.md). */
  live: Record<Direction, boolean>;
}

export interface OneClickConfig {
  /** API host; empty = no 1Click module is built. */
  baseUrl: string;
  /** User agent the server sends: the project's own name, never a browser's. */
  userAgent: string;
  timeoutMs: number;
  /** 1Click asset id of native BCH. */
  bchAsset: string;
  assets: OneClickAsset[];
  /** Addresses no one holds, used only for dry quotes while a person is still typing. A real quote never uses them. */
  placeholders: { bch: string; evm: string };
  /** How long a dry quote is kept in memory (the terms allow at most 24 hours; real quotes are never kept). */
  cacheSeconds: number;
  /** How often a crossing page asks for the status of a 1Click deposit. */
  statusPollSeconds: number;
  /** Pause after the amount stops changing before the page asks for a dry quote. */
  dryDebounceMs: number;
  slippageBps: number;
  /** Deadline of a real quote: after it, 1Click refunds a deposit it did not fill. */
  deadlineMinutes: Record<Direction, number>;
  /** Sampan's own fee on this route: always 0 (PRD 4.6). */
  appFeeBps: number;
}

/** Most a dry quote may stay in memory: 24 hours (1ClickSwap API terms 4.1(e)). */
export const ONECLICK_MAX_CACHE_SECONDS = 86_400;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function validateOneClick(c: OneClickConfig, evmChains: Array<{ key: string; tokens: Record<string, { decimals: number }> }>): string[] {
  const errors: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) errors.push(message);
  };
  const posInt = (v: unknown): boolean => Number.isInteger(v) && (v as number) > 0;
  need(c.baseUrl === '' || /^https:\/\/[^\s/]+\/?$/.test(c.baseUrl), 'oneClick.baseUrl: empty or an https URL (host only)');
  need(/^[a-z][a-z0-9.-]*\/[0-9][^\s]*( \(\+https:\/\/[^\s)]+\))?$/.test(c.userAgent ?? ''), 'oneClick.userAgent: name/version (+https URL)');
  need(posInt(c.timeoutMs), 'oneClick.timeoutMs: positive integer');
  need(/^nep141:[a-z0-9.-]+$/.test(c.bchAsset ?? ''), 'oneClick.bchAsset: a nep141 asset id');
  need(Array.isArray(c.assets), 'oneClick.assets: a list');
  for (const a of c.assets ?? []) {
    const name = `oneClick.assets ${a.chain}.${a.symbol}`;
    need(/^nep141:[a-z0-9.-]+$/.test(a.id), `${name}: id must be a nep141 asset id`);
    const token = evmChains.find((ch) => ch.key === a.chain)?.tokens[a.symbol];
    need(Boolean(token), `${name}: no evm.chains token with this chain and symbol`);
    need(!token || token.decimals === a.decimals, `${name}: decimals must equal the evm.chains token`);
    need(typeof a.live?.out === 'boolean' && typeof a.live?.in === 'boolean', `${name}: live.out and live.in true or false`);
  }
  need(new Set((c.assets ?? []).map((a) => `${a.chain}.${a.symbol}`)).size === (c.assets ?? []).length, 'oneClick.assets: one entry per chain and symbol');
  need(/^bitcoincash:[a-z0-9]{42}$/.test(c.placeholders?.bch ?? ''), 'oneClick.placeholders.bch: a cash address');
  need(EVM_ADDRESS.test(c.placeholders?.evm ?? ''), 'oneClick.placeholders.evm: an EVM address');
  need(
    Number.isInteger(c.cacheSeconds) && c.cacheSeconds >= 0 && c.cacheSeconds <= ONECLICK_MAX_CACHE_SECONDS,
    `oneClick.cacheSeconds: 0 to ${ONECLICK_MAX_CACHE_SECONDS}`,
  );
  need(posInt(c.statusPollSeconds) && posInt(c.dryDebounceMs), 'oneClick.statusPollSeconds, dryDebounceMs: positive integers');
  need(posInt(c.deadlineMinutes?.out) && posInt(c.deadlineMinutes?.in), 'oneClick.deadlineMinutes.out and .in: positive integers');
  need(c.appFeeBps === 0, 'oneClick.appFeeBps: must be 0 (no Sampan fee on any route)');
  return errors;
}

/** The 1Click asset for a chain and symbol, live in a direction; undefined when config does not offer it. */
export const oneClickAsset = (c: OneClickConfig, direction: Direction, chain: string, symbol: string): OneClickAsset | undefined =>
  c.assets.find((a) => a.chain === chain && a.symbol === symbol && a.live[direction]);

/** True when a real quote would carry an address that nobody holds. */
export const isPlaceholder = (c: OneClickConfig, address: string): boolean =>
  address.toLowerCase() === c.placeholders.bch.toLowerCase() ||
  address.toLowerCase() === c.placeholders.evm.toLowerCase() ||
  address.toLowerCase() === c.placeholders.bch.replace(/^bitcoincash:/, '').toLowerCase();

/** What the page reads about 1Click from /api/config: which assets are offered and its timings. No host, no key. */
export interface OneClickPublic {
  assets: Array<Pick<OneClickAsset, 'chain' | 'symbol' | 'live'>>;
  dryDebounceMs: number;
  statusPollSeconds: number;
  deadlineMinutes: Record<Direction, number>;
}

export const oneClickPublic = (c: OneClickConfig): OneClickPublic => ({
  assets: c.assets.map(({ chain, symbol, live }) => ({ chain, symbol, live })),
  dryDebounceMs: c.dryDebounceMs,
  statusPollSeconds: c.statusPollSeconds,
  deadlineMinutes: c.deadlineMinutes,
});

/** True when the page may show and quote the 1Click row for this direction, chain and symbol (flag on, asset live). */
export const offersOneClick = (enabled: boolean, c: Pick<OneClickPublic, 'assets'>, direction: Direction, chain: string, symbol: string): boolean =>
  enabled && c.assets.some((a) => a.chain === chain && a.symbol === symbol && a.live[direction]);
