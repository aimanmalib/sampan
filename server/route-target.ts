// Which route asset a crossing request names, for one direction. Refused with 400 when config does not list it as
// live for that direction (or the chain has no EVM entry), and with 503 chain_halted when the last health check saw its
// chain closed; other assets keep working.
import type { RouteId, SampanConfig } from '../core/config.js';
import { oneClickAsset } from '../core/oneclick-config.js';
import { findAsset, liveAssets, type Direction, type EvmChain, type EvmToken } from '../core/route-assets.js';
import { RouteError } from './routes/types.js';

export interface RouteTarget {
  /** The asset in the route's own form: THORChain asset name, or 1Click asset id. */
  asset: string;
  chain: EvmChain;
  token: EvmToken;
}

export function routeTarget(
  config: SampanConfig,
  direction: Direction,
  r: { chain: string; symbol: string },
  chainOpen: (chain: string) => boolean,
  route: RouteId = 'thorchain',
): RouteTarget {
  // 1Click: its own live list; THORChain's halt report says nothing about it.
  const asset =
    route === 'near-intents'
      ? oneClickAsset(config.oneClick, direction, r.chain, r.symbol)?.id
      : findAsset(liveAssets(config.thorchain.assets, direction), r.chain, r.symbol)?.asset;
  const chain = config.evm.chains.find((c) => c.key === r.chain);
  const token = chain?.tokens[r.symbol];
  if (!asset || !chain || !token) throw new RouteError('bad_request', `${r.symbol} on ${r.chain} is not offered`);
  if (route !== 'near-intents' && !chainOpen(r.chain)) throw new RouteError('chain_halted', `the route reports ${chain.name} halted; try another network`);
  return { asset, chain, token };
}
