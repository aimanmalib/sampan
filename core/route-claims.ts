// What the page may say about crossings, made from config instead of written into sentences (K6P1, ADR 0083): per
// chain, the symbols a crossing carries out of and into Bitcoin Cash, and the routes that carry them. Pure. Built on
// networkStatus, so the text, the chips and the network lists read the same rows: THORChain assets live per direction,
// plus 1Click assets while features.oneClick is on. With an open map (GET /api/health) a halted chain drops out of
// the open directions; without one, config alone decides.
import { networkStatus, type CrossRoute, type OneClickOffer } from './cross-choices.js';
import type { EvmChain, OpenMap, RouteAsset } from './route-assets.js';

/** The parts of the public config a claim reads. */
export interface ClaimOffer {
  routeAssets: readonly RouteAsset[];
  evm: { chains: readonly EvmChain[] };
  features: { oneClick: boolean };
  oneClick: { assets: OneClickOffer['assets'] };
}

export interface ChainClaim {
  key: string;
  name: string;
  /** Symbols a crossing can send out to this chain now, in config order. */
  out: string[];
  /** Symbols a crossing can bring in from this chain now, in config order. */
  in: string[];
  /** Routes that carry at least one of them, THORChain first. */
  via: CrossRoute[];
}

const ROUTE_ORDER: readonly CrossRoute[] = ['thorchain', 'near-intents'];

/** Each listed chain once, in list order, with its open symbols per direction and the routes carrying them. */
export function routeClaims(c: ClaimOffer, open?: OpenMap | null): ChainClaim[] {
  const oc = { enabled: c.features.oneClick, assets: c.oneClick.assets };
  const claims = new Map<string, ChainClaim & { routes: Set<CrossRoute> }>();
  for (const direction of ['out', 'in'] as const) {
    for (const row of networkStatus(c.routeAssets, c.evm.chains, direction, open ?? null, oc)) {
      let claim = claims.get(row.chain.key);
      if (!claim) {
        claim = { key: row.chain.key, name: row.chain.name, out: [], in: [], via: [], routes: new Set() };
        claims.set(row.chain.key, claim);
      }
      if (!row.open) continue;
      if (!claim[direction].includes(row.symbol)) claim[direction].push(row.symbol);
      for (const r of row.routesOpen) claim.routes.add(r);
    }
  }
  return [...claims.values()].map(({ routes, ...claim }) => ({ ...claim, via: ROUTE_ORDER.filter((r) => routes.has(r)) }));
}

/** Routes carrying any claim, THORChain first: the names the page gives for who carries a crossing. */
export const liveRoutes = (claims: readonly ChainClaim[]): CrossRoute[] => ROUTE_ORDER.filter((r) => claims.some((c) => c.via.includes(r)));

/** Per symbol, in first-seen order, the chains a direction reaches with it; empty when the direction reaches none. */
export function claimsFor(claims: readonly ChainClaim[], direction: 'out' | 'in'): { symbol: string; chains: string[] }[] {
  const out = new Map<string, string[]>();
  for (const c of claims) for (const s of c[direction]) out.set(s, [...(out.get(s) ?? []), c.name]);
  return [...out].map(([symbol, chains]) => ({ symbol, chains }));
}

export type ChipKey = 'hero.chip.open' | 'hero.chip.outOnly' | 'hero.chip.inOnly' | 'hero.chip.paused';

/** The chip text for a chain: open both ways, one way only, or paused when listed but nothing is open. */
export function chipKey(c: Pick<ChainClaim, 'out' | 'in'>): ChipKey {
  if (c.out.length > 0 && c.in.length > 0) return 'hero.chip.open';
  if (c.out.length > 0) return 'hero.chip.outOnly';
  if (c.in.length > 0) return 'hero.chip.inOnly';
  return 'hero.chip.paused';
}
