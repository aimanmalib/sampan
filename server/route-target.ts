// Which route asset a crossing request names, for one direction. Refused with 400 when config does not list it as
// live for that direction (or the chain has no EVM entry), and with 503 chain_halted when the last health check saw its
// chain closed; other assets keep working.
import type { SampanConfig } from '../core/config.js';
import { findAsset, liveAssets, type Direction, type EvmChain, type EvmToken } from '../core/route-assets.js';
import { RouteError } from './routes/types.js';

export interface RouteTarget {
  /** THORChain asset name from config. */
  asset: string;
  chain: EvmChain;
  token: EvmToken;
}

export function routeTarget(
  config: SampanConfig,
  direction: Direction,
  r: { chain: string; symbol: string },
  chainOpen: (chain: string) => boolean,
): RouteTarget {
  const a = findAsset(liveAssets(config.thorchain.assets, direction), r.chain, r.symbol);
  const chain = config.evm.chains.find((c) => c.key === r.chain);
  const token = chain?.tokens[r.symbol];
  if (!a || !chain || !token) throw new RouteError('bad_request', `${r.symbol} on ${r.chain} is not offered`);
  if (!chainOpen(r.chain)) throw new RouteError('chain_halted', `the route reports ${chain.name} halted; try another network`);
  return { asset: a.asset, chain, token };
}
