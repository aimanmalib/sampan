// The active route, or none. Only the module of config route.active is constructed.
import type { SampanConfig } from '../../core/config.js';
import { fakeThornode } from './fake.js';
import { ThorchainRoute } from './thorchain.js';
import { Thornode, httpGet } from './thornode.js';
import type { Route } from './types.js';

export function createRoute(config: SampanConfig, fake: boolean, fakeInbound?: string): Route | null {
  if (config.route.active === 'thorchain') {
    const node = new Thornode(config.thorchain.nodes, fake ? fakeThornode(undefined, undefined, fakeInbound) : httpGet, config.thorchain.timeoutMs);
    return new ThorchainRoute({ node, slippageBps: config.thorchain.slippageBps, minSatsPerByte: BigInt(config.fees.satsPerByte) });
  }
  // Route A (near-intents) has no module until the owner's written yes; see docs/decisions/0013.
  return null;
}
