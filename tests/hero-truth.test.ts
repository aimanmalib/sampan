// The hero promises a crossing only while the route's live state carries one (KMN1, ADR 0067): flags on and the last
// health report open with at least one live asset on an open chain; {symbols} names only those assets; no report,
// an unknown check or a halted route = no promise. The link preview text written at serve time never promises one.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import type { HealthReport } from '../core/client/health.js';
import { normalizeConfig, type SampanConfig } from '../core/config.js';
import { heroSubKey, openFlows, openSymbols } from '../core/flows.js';
import { staticDescriptionKey } from '../core/page-meta.js';
import type { RouteAsset } from '../core/route-assets.js';

const en = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8')) as Record<string, string>;
const chains = normalizeConfig(shipped as unknown as SampanConfig).evm.chains;
// Fixture assets (not the shipped live flags): USDC on Ethereum both ways, USDC and USDT on BNB Smart Chain out only.
const routeAssets: RouteAsset[] = [
  { asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', chain: 'ETH', symbol: 'USDC', live: { out: true, in: true } },
  { asset: 'BSC.USDT-0X55D398326F99059FF775485246999027B3197955', chain: 'BSC', symbol: 'USDT', live: { out: true, in: false } },
];
const config = {
  features: { swap: true, landing: true, oneClick: false },
  route: { active: 'thorchain', symbols: ['USDC', 'USDT'] },
  compliance: { crossChainEnabled: true },
  routeAssets,
  evm: { chains },
  oneClick: { assets: [] as Array<{ chain: string; symbol: string; live: { out: boolean; in: boolean } }> },
};
const report = (open: boolean | null, map: Record<string, boolean> | null = null): HealthReport => ({
  checkedAt: 1,
  cauldron: true,
  bch: true,
  height: 1,
  route: { id: 'thorchain', open, chains: map },
});

describe('hero follows the route health', () => {
  it('promises no crossing while the route reports itself halted, though the flags are on', () => {
    const halted = report(false, { BCH: true, ETH: false, BSC: false });
    expect(openFlows(config).cross).toBe(true);
    expect(openFlows(config, halted).cross).toBe(false);
    expect(openSymbols(config, halted)).toEqual([]);
    expect(heroSubKey(openFlows(config, halted))).toBe('hero.sub.swap-land');
    // The route's own verdict wins over a chain map that still marks chains open (trading halted on the whole route).
    expect(openFlows(config, report(false, { BCH: true, ETH: true, BSC: true })).cross).toBe(false);
    expect(openFlows(config, report(null, { BCH: true, ETH: true, BSC: true })).cross).toBe(false);
  });

  it('promises no crossing before the first report, or while the check is unknown', () => {
    expect(openFlows(config, null).cross).toBe(false);
    expect(openFlows(config, report(null)).cross).toBe(false);
    expect(openFlows(config, { ...report(true), route: null }).cross).toBe(false);
    // Open without a chain map: every chain counts closed.
    expect(openFlows(config, report(true, null)).cross).toBe(false);
  });

  it('names only the symbols on chains the route reports open', () => {
    expect(openSymbols(config, report(true, { BCH: true, ETH: true, BSC: false }))).toEqual(['USDC']);
    expect(openSymbols(config, report(true, { BCH: true, ETH: false, BSC: true }))).toEqual(['USDT']);
    expect(openSymbols(config, report(true, { BCH: true, ETH: true, BSC: true }))).toEqual(['USDC', 'USDT']);
    expect(openFlows(config, report(true, { BCH: true, ETH: true, BSC: false })).cross).toBe(true);
  });

  it('promises no crossing when Bitcoin Cash itself is halted on the route', () => {
    expect(openFlows(config, report(true, { BCH: false, ETH: true, BSC: true })).cross).toBe(false);
  });

  it('counts a chain 1Click carries while THORChain halts it, only while 1Click is on', () => {
    const oc = { ...config, features: { ...config.features, oneClick: true }, oneClick: { assets: [{ chain: 'ETH', symbol: 'USDC', live: { out: true, in: false } }] } };
    const ethHalted = report(true, { BCH: true, ETH: false, BSC: false });
    expect(openSymbols(oc, ethHalted)).toEqual(['USDC']);
    expect(openSymbols(config, ethHalted)).toEqual([]);
  });

  it('keeps the flags as the only gate where no report is given (tabs, terms)', () => {
    expect(openFlows({ ...config, compliance: { crossChainEnabled: false } }, report(true, { BCH: true, ETH: true })).cross).toBe(false);
    expect(openFlows({ ...config, compliance: { crossChainEnabled: false } }).cross).toBe(false);
  });

  it('writes a link preview description that never promises a crossing', () => {
    const key = staticDescriptionKey(config);
    expect(key).toBe('meta.description.swap-land');
    expect(en[key]).not.toMatch(/\{symbols\}|USDC|USDT/);
  });
});
