// The shipped config with every cross-chain crossing switched off: no live route asset, no route symbol and
// crossChainEnabled false. Tests that check the "off" answers start here so they do not depend on what the
// config file currently marks live from measured runs.
import type { SampanConfig } from '../../core/config.js';
import type { RouteAsset } from '../../core/route-assets.js';

export const assetsOff = (assets: readonly RouteAsset[]): RouteAsset[] => assets.map((a) => ({ ...a, live: { out: false, in: false } }));

export const allOff = <C extends SampanConfig>(c: C): C => ({
  ...c,
  route: { ...c.route, symbols: [] },
  thorchain: { ...c.thorchain, assets: assetsOff(c.thorchain.assets) },
  compliance: { ...c.compliance, crossChainEnabled: false },
});
