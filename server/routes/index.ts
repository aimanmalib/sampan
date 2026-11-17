// The routes config switches on. The active route (route.active, always THORChain on this site) and, next to it, the
// 1Click route while features.oneClick is true (ADR 0048, ADR 0049). The browser never reaches either provider.
import type { SampanConfig } from '../../core/config.js';
import { fakeThornode } from './fake.js';
import { fakeOneClick } from './fake-oneclick.js';
import { OneClickApi } from './oneclick-api.js';
import { OneClickRoute } from './oneclick.js';
import { ThorchainRoute } from './thorchain.js';
import { Thornode, httpGet } from './thornode.js';
import type { Route } from './types.js';

export function createRoute(config: SampanConfig, fake: boolean, fakeInbound?: string): Route | null {
  if (config.route.active === 'thorchain') {
    const node = new Thornode(config.thorchain.nodes, fake ? fakeThornode(undefined, undefined, fakeInbound) : httpGet, config.thorchain.timeoutMs);
    return new ThorchainRoute({ node, slippageBps: config.thorchain.slippageBps, minSatsPerByte: BigInt(config.fees.satsPerByte) });
  }
  return null;
}

/** The 1Click route, or null while features.oneClick is false. `apiKey`: ONECLICK_JWT, sent as X-API-Key only. */
export function createOneClick(config: SampanConfig, fake: boolean, apiKey?: string): OneClickRoute | null {
  const c = config.oneClick;
  if (!config.features.oneClick || c.baseUrl === '') return null;
  const decimalsOf = (id: string): number => c.assets.find((a) => a.id === id)?.decimals ?? 0;
  const api = new OneClickApi({
    baseUrl: c.baseUrl,
    userAgent: c.userAgent,
    timeoutMs: c.timeoutMs,
    cacheSeconds: c.cacheSeconds,
    apiKey,
    ...(fake ? { http: fakeOneClick(c.bchAsset, decimalsOf) } : {}),
  });
  return new OneClickRoute({ api, config: c, minSatsPerByte: BigInt(config.fees.satsPerByte) });
}

/** Every route config switches on, the active one first. */
export function createRoutes(config: SampanConfig, fake: boolean, fakeInbound?: string, oneClickKey?: string): Route[] {
  return [createRoute(config, fake, fakeInbound), createOneClick(config, fake, oneClickKey)].filter((r): r is Route => r !== null);
}
