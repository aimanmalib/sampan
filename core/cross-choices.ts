// The networks a crossing panel offers for a direction, from both routes (KSG3, ADR 0063). Pure.
// THORChain: its live assets whose chain its last health check saw open (openChoices). 1Click: with features.oneClick
// on, its assets live in that direction, whatever THORChain reports for the same chain; 1Click has no per-chain halt
// report, so its configured chains count as open (server/routes/oneclick.ts open()). One choice per chain and symbol.
import type { OneClickPublic } from './oneclick-config.js';
import { findAsset, openChoices, type Direction, type EvmChain, type OpenMap, type RouteAsset, type RouteChoice } from './route-assets.js';

export interface CrossChoice extends RouteChoice {
  /** True when THORChain offers this choice right now (live and its chain open); false = only 1Click does. */
  thor: boolean;
}

export interface OneClickOffer {
  enabled: boolean;
  assets: OneClickPublic['assets'];
}

/** True when 1Click is switched on and offers at least one asset in this direction. */
export const oneClickOffers = (oc: OneClickOffer, direction: Direction): boolean => oc.enabled && oc.assets.some((a) => a.live[direction]);

export function crossChoices(
  thorAssets: readonly RouteAsset[],
  chains: readonly EvmChain[],
  direction: Direction,
  open: OpenMap | null | undefined,
  oc: OneClickOffer,
): CrossChoice[] {
  const out: CrossChoice[] = openChoices(thorAssets, chains, direction, open).map((c) => ({ ...c, thor: true }));
  if (!oc.enabled) return out;
  for (const a of oc.assets) {
    if (!a.live[direction] || out.some((c) => c.chain.key === a.chain && c.symbol === a.symbol)) continue;
    const chain = chains.find((c) => c.key === a.chain);
    const token = chain?.tokens[a.symbol];
    if (!chain || !token) continue;
    // The THORChain name of the same asset when config lists one (the page keys choices by it), else chain.symbol.
    const asset = findAsset(thorAssets, a.chain, a.symbol)?.asset ?? `${a.chain}.${a.symbol}`;
    out.push({ asset, symbol: a.symbol, chain, token, thor: false });
  }
  return out;
}
