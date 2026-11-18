// The networks a crossing panel lists for a direction, from both routes, with each one's state (KSG3, KSG6; ADR 0063,
// ADR 0064). Pure. Listed: every asset live in that direction on a route that is switched on (THORChain; 1Click while
// features.oneClick is on). THORChain carries a choice while its last health check saw Bitcoin Cash and that chain
// open, or while the check is unknown (the server answers then); 1Click has no per-chain halt report, so its
// configured chains count as open (server/routes/oneclick.ts open()). A choice no route carries now stays listed as
// paused, named by the route that stopped it, instead of dropping out. One row per chain and symbol, in config order.
import type { OneClickPublic } from './oneclick-config.js';
import { findAsset, routeChoices, type Direction, type EvmChain, type OpenMap, type RouteAsset, type RouteChoice } from './route-assets.js';

/** The two routes a network row can be carried by. THORChain is config.route.active; 1Click is near-intents. */
export type CrossRoute = 'thorchain' | 'near-intents';

export interface CrossChoice extends RouteChoice {
  /** True when THORChain offers this choice right now (live and its chain open); false = only 1Click can. */
  thor: boolean;
}

export interface NetworkRow extends CrossChoice {
  /** True when at least one route carries this choice now: it can be picked and quoted. */
  open: boolean;
  /** Routes that carry it now, THORChain first. */
  routesOpen: CrossRoute[];
  /** Routes that list it live but report its chain (or Bitcoin Cash) halted now. */
  pausedBy: CrossRoute[];
}

export interface OneClickOffer {
  enabled: boolean;
  assets: OneClickPublic['assets'];
}

/** True when 1Click is switched on and offers at least one asset in this direction. */
export const oneClickOffers = (oc: OneClickOffer, direction: Direction): boolean => oc.enabled && oc.assets.some((a) => a.live[direction]);

/** THORChain carries a chain while its check is unknown, or saw Bitcoin Cash and that chain open. */
const thorCarries = (open: OpenMap | null | undefined, chain: string): boolean => !open || (open['BCH'] === true && open[chain] === true);

/** Every network the panel lists for a direction, open or paused. */
export function networkStatus(
  thorAssets: readonly RouteAsset[],
  chains: readonly EvmChain[],
  direction: Direction,
  open: OpenMap | null | undefined,
  oc: OneClickOffer,
): NetworkRow[] {
  const ocLive = (chain: string, symbol: string): boolean =>
    oc.enabled && oc.assets.some((a) => a.chain === chain && a.symbol === symbol && a.live[direction]);
  const row = (c: RouteChoice, thorLive: boolean): NetworkRow => {
    const thor = thorLive && thorCarries(open, c.chain.key);
    const routesOpen: CrossRoute[] = [...(thor ? (['thorchain'] as const) : []), ...(ocLive(c.chain.key, c.symbol) ? (['near-intents'] as const) : [])];
    return { ...c, thor, open: routesOpen.length > 0, routesOpen, pausedBy: thorLive && !thor ? ['thorchain'] : [] };
  };
  const rows = routeChoices(thorAssets, chains, direction).map((c) => row(c, true));
  if (!oc.enabled) return rows;
  for (const a of oc.assets) {
    if (!a.live[direction] || rows.some((r) => r.chain.key === a.chain && r.symbol === a.symbol)) continue;
    const chain = chains.find((c) => c.key === a.chain);
    const token = chain?.tokens[a.symbol];
    if (!chain || !token) continue;
    // The THORChain name of the same asset when config lists one (the page keys choices by it), else chain.symbol.
    const asset = findAsset(thorAssets, a.chain, a.symbol)?.asset ?? `${a.chain}.${a.symbol}`;
    rows.push(row({ asset, symbol: a.symbol, chain, token }, false));
  }
  return rows;
}

/** The choices a panel can pick now (the open rows of networkStatus). */
export const crossChoices = (...args: Parameters<typeof networkStatus>): CrossChoice[] => networkStatus(...args).filter((r) => r.open);

/**
 * True when the whole crossing tab is paused: rows are listed but none is open (Bitcoin Cash halted, or every listed
 * chain halted with no other route carrying it). With no rows at all, the route's own report decides.
 */
export const crossingPaused = (rows: readonly NetworkRow[], routeHalted: boolean): boolean => (rows.length > 0 ? !rows.some((r) => r.open) : routeHalted);
