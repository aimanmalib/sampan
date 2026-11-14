// Shape of config/sampan.json and the checks run when it is loaded.
// Pure: no I/O. The server reads the file; the page receives the public part from /api/config.

export type RouteId = 'near-intents' | 'thorchain';
export type ActiveRoute = RouteId | 'none';

export interface TokenConfig {
  symbol: string;
  name: string;
  category: string;
  decimals: number;
  icon: string;
}

export interface EvmChainConfig {
  id: number;
  key: string;
  name: string;
  rpc: string;
  explorer: string;
  tokens: Record<string, string>;
}

export interface SampanConfig {
  tokens: Record<string, TokenConfig>;
  defaultToken: string;
  features: { musd: boolean };
  route: { active: ActiveRoute; symbols: string[] };
  thorchain: { nodes: string[]; chains: string[]; slippageBps: number; affiliate: string; affiliateBps: number };
  oneClick: {
    baseUrl: string;
    chains: string[];
    inMinUsdByChain: Record<string, number>;
    disabledChains: string[];
    slippageBps: number;
    deadlineMinutes: { out: number; in: number };
    appFeeBps: number;
  };
  evm: { chains: EvmChainConfig[]; walletConnectProjectId: string };
  cauldron: { indexers: string[]; maxPoolsPerTx: number; slippageBps: number; outSafetyBps: number };
  electrum: { servers: string[]; chipnetServers: string[] };
  landing: {
    toleranceBps: number;
    toleranceBpsDirect: number;
    returnAfterBlocks: number;
    returnFeeCapSats: number;
    tokenDustSats: number;
  };
  limits: {
    minUsd: number;
    localMinSats: number;
    maxUsd: number;
    judgeLandBch: string;
    judgeSwapBch: string;
    judgeOutToken: Record<RouteId, string>;
    routeMinUsd: Record<RouteId, number>;
  };
  fees: { satsPerByte: number };
  rate: { quotesPerMinute: number; crossingsPerHour: number };
  compliance: { blockedCountries: string[]; crossChainEnabled: boolean };
  banner: { deckUrl: string; repoUrl: string; tokenAddress: string; note: boolean };
  site: { noindex: boolean; feedbackUrl: string };
  ops: { healthIntervalSeconds: number };
}

/** The part of the config the page needs. Everything else stays on the server. */
export interface PublicConfig {
  tokens: Record<string, TokenConfig>;
  defaultToken: string;
  features: SampanConfig['features'];
  route: SampanConfig['route'];
  evm: { chains: EvmChainConfig[]; walletConnect: boolean };
  limits: SampanConfig['limits'];
  compliance: { crossChainEnabled: boolean };
  banner: SampanConfig['banner'];
  site: SampanConfig['site'];
}

const HEX32 = /^[0-9a-f]{64}$/;
const ROUTES: readonly ActiveRoute[] = ['none', 'near-intents', 'thorchain'];

function isHttpsUrl(value: string): boolean {
  return /^https:\/\/[^\s]+$/.test(value);
}

/** Returns a list of problems; an empty list means the config can be used. */
export function validateConfig(c: SampanConfig): string[] {
  const errors: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) errors.push(message);
  };

  const tokens = Object.entries(c.tokens ?? {});
  need(tokens.length > 0, 'tokens: at least one token');
  for (const [key, t] of tokens) {
    need(t.symbol === key, `tokens.${key}: symbol must equal its key`);
    need(HEX32.test(t.category), `tokens.${key}: category must be 64 lowercase hex characters`);
    need(Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 18, `tokens.${key}: decimals 0 to 18`);
  }
  need(Boolean(c.tokens?.[c.defaultToken]), 'defaultToken: must name a configured token');
  need(ROUTES.includes(c.route?.active), 'route.active: none, near-intents or thorchain');
  need(c.thorchain.nodes.length > 0 && c.thorchain.nodes.every(isHttpsUrl), 'thorchain.nodes: https URLs');
  need(c.oneClick.baseUrl === '' || isHttpsUrl(c.oneClick.baseUrl), 'oneClick.baseUrl: empty or an https URL');
  need(c.route.active !== 'near-intents' || c.oneClick.baseUrl !== '', 'oneClick.baseUrl: required for near-intents');
  need(c.cauldron.indexers.length > 0 && c.cauldron.indexers.every(isHttpsUrl), 'cauldron.indexers: https URLs');
  need(c.electrum.servers.length >= 3, 'electrum.servers: at least three servers');
  need(c.evm.chains.length > 0 && c.evm.chains.every((ch) => isHttpsUrl(ch.rpc)), 'evm.chains: https RPC per chain');
  for (const ch of c.evm.chains) {
    for (const [sym, addr] of Object.entries(ch.tokens)) {
      need(/^0x[0-9a-fA-F]{40}$/.test(addr), `evm.chains.${ch.key}.tokens.${sym}: 20-byte hex address`);
    }
  }
  const bps = [
    c.thorchain.slippageBps,
    c.oneClick.slippageBps,
    c.cauldron.slippageBps,
    c.cauldron.outSafetyBps,
    c.landing.toleranceBps,
    c.landing.toleranceBpsDirect,
  ];
  need(bps.every((v) => Number.isInteger(v) && v >= 0 && v < 10000), 'basis points: integers from 0 to 9999');
  need(c.limits.minUsd > 0 && c.limits.maxUsd > c.limits.minUsd, 'limits: 0 < minUsd < maxUsd');
  need(Number.isInteger(c.limits.localMinSats) && c.limits.localMinSats > 0, 'limits.localMinSats: positive integer');
  need(c.fees.satsPerByte >= 1, 'fees.satsPerByte: at least 1');
  need(c.ops.healthIntervalSeconds >= 30, 'ops.healthIntervalSeconds: at least 30');
  need(c.compliance.blockedCountries.every((cc) => /^[A-Z]{2}$/.test(cc)), 'compliance.blockedCountries: ISO codes');
  for (const url of [c.banner.deckUrl, c.banner.repoUrl, c.site.feedbackUrl]) {
    need(url === '' || isHttpsUrl(url) || url.startsWith('/'), `URL must be empty, a path or https: ${url}`);
  }
  return errors;
}

export function publicConfig(c: SampanConfig): PublicConfig {
  return {
    tokens: Object.fromEntries(
      Object.entries(c.tokens).filter(([key]) => key === c.defaultToken || (key === 'MUSD' && c.features.musd)),
    ),
    defaultToken: c.defaultToken,
    features: c.features,
    route: c.route,
    evm: { chains: c.evm.chains, walletConnect: c.evm.walletConnectProjectId !== '' },
    limits: c.limits,
    compliance: { crossChainEnabled: c.compliance.crossChainEnabled },
    banner: c.banner,
    site: c.site,
  };
}
