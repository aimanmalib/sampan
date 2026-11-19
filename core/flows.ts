// Which flows are open, and which text keys may describe them. Page text only promises a flow whose flag is on
// (a flag is switched on after the flow is measured on mainnet). Every combination has its own lang key so each
// language can phrase it whole instead of gluing sentence parts together.
//
// Text that promises a crossing also follows the route's live state (KMN1, ADR 0067): with the page's last health
// report, a crossing is promised only while the route reports itself open and at least one live asset sits on a chain
// it reports open, and {symbols} names only those assets. No report yet, an unknown or failed check = no promise, which
// is stricter than the server (it still quotes while the state is unknown): the text does not promise what is unchecked.
import type { HealthReport } from './client/health.js';
import { networkStatus, type OneClickOffer } from './cross-choices.js';
import type { EvmChain, RouteAsset } from './route-assets.js';

export interface FlowFlags {
  features: { swap: boolean; landing: boolean };
  route: { active: string; symbols: string[] };
  compliance: { crossChainEnabled: boolean };
}

export interface OpenFlows {
  /** Swap BCH and the stablecoin on Bitcoin Cash. */
  swap: boolean;
  /** Landing address: BCH from any wallet arrives as the stablecoin, or goes back. */
  land: boolean;
  /** Crossing to and from another chain through the active route. */
  cross: boolean;
}

export type FlowCombo = 'none' | 'swap' | 'land' | 'cross' | 'swap-land' | 'swap-cross' | 'land-cross' | 'swap-land-cross';

export type TabId = 'swap' | 'out' | 'in';

/** What the network lists need: the assets live on THORChain, the chains, and 1Click's offer. */
export interface CrossOffer {
  routeAssets: readonly RouteAsset[];
  evm: { chains: readonly EvmChain[] };
  features: { oneClick: boolean };
  oneClick: { assets: OneClickOffer['assets'] };
}

/**
 * Symbols a crossing can carry right now in either direction, in config order: none unless the last health report
 * says the route is open; then the open rows of the same per-chain status the network lists show (KSG6). A report
 * that is open without a chain map counts every chain closed (the server always sends the map with an open route).
 */
export function openSymbols(c: (FlowFlags & CrossOffer) | null, health: HealthReport | null): string[] {
  if (!c || health?.route?.open !== true) return [];
  const map = health.route.chains ?? {};
  const oc = { enabled: c.features.oneClick, assets: c.oneClick.assets };
  const rows = (['out', 'in'] as const).flatMap((d) => networkStatus(c.routeAssets, c.evm.chains, d, map, oc));
  return [...new Set(rows.filter((r) => r.open).map((r) => r.symbol))];
}

/**
 * The flows the flags open. With a health report (the hero and the page description), a crossing also needs
 * openSymbols to name at least one asset; without one (tabs, terms, the static link preview text) flags decide.
 */
export function openFlows(c: FlowFlags | null): OpenFlows;
export function openFlows(c: (FlowFlags & CrossOffer) | null, health: HealthReport | null): OpenFlows;
export function openFlows(c: FlowFlags | null, health?: HealthReport | null): OpenFlows {
  if (!c) return { swap: false, land: false, cross: false };
  const flagged = c.compliance.crossChainEnabled && c.route.active !== 'none' && c.route.symbols.length > 0;
  // undefined = no report given (flags decide); null = the page has no report yet (no promise).
  const checked = health === undefined || openSymbols(c as FlowFlags & CrossOffer, health).length > 0;
  return { swap: c.features.swap, land: c.features.landing, cross: flagged && checked };
}

export function flowCombo(f: OpenFlows): FlowCombo {
  const parts = (['swap', 'land', 'cross'] as const).filter((k) => f[k]);
  return parts.length === 0 ? 'none' : (parts.join('-') as FlowCombo);
}

export const heroSubKey = (f: OpenFlows) => `hero.sub.${flowCombo(f)}` as const;
export const descriptionKey = (f: OpenFlows) => `meta.description.${flowCombo(f)}` as const;

/** Tabs whose flow is open. "Bring in" covers both the landing address and crossings in. */
export function openTabs(f: OpenFlows): TabId[] {
  const tabs: TabId[] = [];
  if (f.swap) tabs.push('swap');
  if (f.cross) tabs.push('out');
  if (f.land || f.cross) tabs.push('in');
  return tabs;
}

/** "USDC" or "USDC and USDT": the assets the active route carries, in the page's own word for "and". */
export function symbolList(symbols: string[], and: string): string {
  if (symbols.length < 2) return symbols.join('');
  return `${symbols.slice(0, -1).join(', ')} ${and} ${symbols[symbols.length - 1]}`;
}
