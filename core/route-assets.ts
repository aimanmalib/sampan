// The stablecoins the THORChain route carries, as config lists them (thorchain.assets, one source). An asset is
// offered in one direction only when config marks it live for that direction (a measured mainnet run exists) and
// the route reports its chain open; the open map comes from one inbound_addresses read (server/routes/thorchain.ts).
// Pure: no I/O.
import { thorAsset } from './routes/memo.js';

export type Direction = 'out' | 'in';

export interface RouteAsset {
  /** THORChain asset exactly as /thorchain/pools names it, e.g. ETH.USDC-0XA0B8…. */
  asset: string;
  /** THORChain chain key, e.g. ETH; for an EVM chain also the key of its evm.chains entry. */
  chain: string;
  symbol: string;
  live: Record<Direction, boolean>;
}

export interface EvmToken {
  address: string;
  /** Read from the chain (BNB Smart Chain stablecoins carry 18, most others 6). */
  decimals: number;
}

export interface EvmChain {
  id: number;
  key: string;
  name: string;
  /** At least two public https endpoints; the first is the one a wallet is offered. */
  rpc: string[];
  explorer: string;
  /** The chain's gas coin, as a wallet is told when the chain is added. */
  native: { name: string; symbol: string };
  /** Gas units of one approve and one router deposit (measured medians, ADR 0041) and the block time, for the cost card. */
  gas: { approve: number; deposit: number; blockSeconds: number };
  tokens: Record<string, EvmToken>;
}

/** Open state per chain key from the route, BCH included. A chain missing from the map counts as closed. */
export type OpenMap = Record<string, boolean>;

/** One row of THORNode /thorchain/inbound_addresses, as far as open state goes. */
export interface InboundRow {
  chain: string;
  halted?: boolean;
  global_trading_paused?: boolean;
  chain_trading_paused?: boolean;
}

/** Open = not halted and neither chain nor global trading paused. */
export const openMapOf = (rows: readonly InboundRow[]): OpenMap =>
  Object.fromEntries(rows.map((r) => [r.chain, !r.halted && !r.global_trading_paused && !r.chain_trading_paused]));

/** Assets live for a direction (either direction when none is given). */
export function liveAssets(assets: readonly RouteAsset[], direction?: Direction): RouteAsset[] {
  return assets.filter((a) => (direction ? a.live[direction] : a.live.out || a.live.in));
}

/** Distinct chains and symbols of the given assets, in list order. */
export const chainsOf = (assets: readonly RouteAsset[]): string[] => [...new Set(assets.map((a) => a.chain))];
export const symbolsOf = (assets: readonly RouteAsset[]): string[] => [...new Set(assets.map((a) => a.symbol))];

/**
 * Is the route open for these assets? BCH must be open and at least one of the assets' chains must be; with no
 * assets at all there is nothing to cross to.
 */
export function routeOpenFor(open: OpenMap, assets: readonly RouteAsset[]): boolean {
  return open['BCH'] === true && chainsOf(assets).some((c) => open[c] === true);
}

/** Assets live for a direction whose chain is open now. */
export const offered = (assets: readonly RouteAsset[], direction: Direction, open: OpenMap): RouteAsset[] =>
  open['BCH'] === true ? liveAssets(assets, direction).filter((a) => open[a.chain] === true) : [];

/** The asset with this chain and symbol, if config lists it. */
export const findAsset = (assets: readonly RouteAsset[], chain: string, symbol: string): RouteAsset | undefined =>
  assets.find((a) => a.chain === chain && a.symbol === symbol);

/** Problems with the asset list against the EVM chains; empty when it can be used. */
export function validateAssets(assets: readonly RouteAsset[] | undefined, chains: readonly EvmChain[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(assets) || assets.length === 0) return ['thorchain.assets: at least one asset'];
  const seen = new Set<string>();
  for (const a of assets) {
    const at = `thorchain.assets.${a.asset}`;
    const m = /^([A-Z0-9]+)\.([A-Z0-9]+)-([0-9A-Z]+)$/.exec(a.asset ?? '');
    if (!m || m[1] !== a.chain || m[2] !== a.symbol) errors.push(`${at}: must read CHAIN.SYMBOL-CONTRACT with its chain and symbol`);
    if (seen.has(a.asset)) errors.push(`${at}: listed twice`);
    seen.add(a.asset);
    if (!a.live || typeof a.live.out !== 'boolean' || typeof a.live.in !== 'boolean') errors.push(`${at}: live needs out and in, true or false`);
    const chain = chains.find((c) => c.key === a.chain);
    if (!chain) {
      // A chain that is not EVM (TRON) has no client code yet: it may be listed, never live.
      if (a.live?.out || a.live?.in) errors.push(`${at}: live needs an evm.chains entry for ${a.chain}`);
      continue;
    }
    const token = chain.tokens[a.symbol];
    if (!token) errors.push(`${at}: evm.chains.${a.chain}.tokens has no ${a.symbol}`);
    else if (thorAsset(a.chain, a.symbol, token.address) !== a.asset) errors.push(`${at}: contract differs from evm.chains.${a.chain}.tokens.${a.symbol}`);
  }
  return errors;
}

/** Problems with one EVM chain entry. */
export function validateEvmChain(ch: EvmChain, isHttpsUrl: (u: string) => boolean): string[] {
  const errors: string[] = [];
  const at = `evm.chains.${ch.key}`;
  if (!Number.isInteger(ch.id) || ch.id <= 0) errors.push(`${at}.id: a positive integer`);
  if (!Array.isArray(ch.rpc) || ch.rpc.length < 2 || !ch.rpc.every(isHttpsUrl)) errors.push(`${at}.rpc: at least two https URLs`);
  if (!isHttpsUrl(ch.explorer ?? '')) errors.push(`${at}.explorer: an https URL`);
  if (!ch.native?.name || !ch.native?.symbol) errors.push(`${at}.native: name and symbol`);
  const g = ch.gas;
  if (!g || ![g.approve, g.deposit, g.blockSeconds].every((v) => Number.isInteger(v) && v > 0)) errors.push(`${at}.gas: approve, deposit and blockSeconds as positive integers`);
  for (const [sym, t] of Object.entries(ch.tokens ?? {})) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(t?.address ?? '')) errors.push(`${at}.tokens.${sym}.address: 20-byte hex address`);
    if (!Number.isInteger(t?.decimals) || t.decimals < 0 || t.decimals > 36) errors.push(`${at}.tokens.${sym}.decimals: 0 to 36`);
  }
  return errors;
}

export interface RouteChoice {
  asset: string;
  symbol: string;
  chain: EvmChain;
  token: EvmToken;
}

/** Live assets for a direction on chains with an EVM entry, joined with that entry (what the page can offer). */
export function routeChoices(assets: readonly RouteAsset[], chains: readonly EvmChain[], direction: Direction): RouteChoice[] {
  return liveAssets(assets, direction).flatMap((a) => {
    const chain = chains.find((c) => c.key === a.chain);
    const token = chain?.tokens[a.symbol];
    return chain && token ? [{ asset: a.asset, symbol: a.symbol, chain, token }] : [];
  });
}

/**
 * What a page offers for a direction right now: the live choices whose chain the route reports open. While the open
 * map is unknown (no check yet, or THORNode not answering) every live choice stays, and the server answers for it.
 */
export function openChoices(assets: readonly RouteAsset[], chains: readonly EvmChain[], direction: Direction, open: OpenMap | null | undefined): RouteChoice[] {
  const all = routeChoices(assets, chains, direction);
  if (!open) return all;
  const names = new Set(offered(assets, direction, open).map((a) => a.asset));
  return all.filter((c) => names.has(c.asset));
}

/**
 * The asset list with the named assets (exact name, or every asset of a chain key) live both ways. For a
 * SAMPAN_CONFIG_PATCH of a local test or measurement server only; the config file marks live from measured runs.
 */
export const withLive = (assets: readonly RouteAsset[], names: readonly string[]): RouteAsset[] =>
  assets.map((a) => (names.includes(a.asset) || names.includes(a.chain) ? { ...a, live: { out: true, in: true } } : a));

/** The SAMPAN_CONFIG_PATCH part that switches those assets live: the asset list and the route.symbols it implies. */
export function livePatch(assets: readonly RouteAsset[], names: readonly string[]): { route: { symbols: string[] }; thorchain: { assets: RouteAsset[] } } {
  const next = withLive(assets, names);
  return { route: { symbols: symbolsOf(liveAssets(next)) }, thorchain: { assets: next } };
}
