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
  /** A flow stays hidden until it has been measured on mainnet (SAMPAN_CONFIG_PATCH can switch it on for tests). */
  features: { musd: boolean; swap: boolean; landing: boolean };
  route: { active: ActiveRoute; symbols: string[] };
  thorchain: {
    nodes: string[];
    chains: string[];
    slippageBps: number;
    timeoutMs: number;
    /** Highest deposit fee rate (sat/byte) a quote may ask for; also the rate used to reserve fees. */
    maxGasRate: number;
    affiliate: string;
    affiliateBps: number;
  };
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
  cauldron: {
    indexers: string[];
    maxPoolsPerTx: number;
    slippageBps: number;
    outSafetyBps: number;
    /** How long one indexer answer is reused. */
    cacheSeconds: number;
    /** Builds tried with freshly fetched pools before the user sees an error. */
    buildAttempts: number;
  };
  electrum: {
    servers: string[];
    chipnetServers: string[];
    /** After a broadcast, how long to wait for the server's index to show the transaction before answering. */
    indexWaitMs: number;
    indexPollMs: number;
  };
  /** Wallet scan: stop after `gapLimit` unused addresses in a row; results are kept in memory only. */
  wallet: { gapLimit: number; maxAddressesPerScan: number; scanCacheSeconds: number };
  /** Page side of the BCH wallet connection: WizardConnect relays, scan rounds and the explorer link. */
  connect: { relayUrls: string[]; maxScanRounds: number; explorerTxUrl: string };
  landing: {
    toleranceBps: number;
    toleranceBpsDirect: number;
    returnAfterBlocks: number;
    returnFeeCapSats: number;
    tokenDustSats: number;
    /** Miner fee assumed for the convert transaction when the minimum rate is set (worst case, one pool). */
    convertFeeSats: number;
    /** The page says payments within this many hours convert; later ones may come back. */
    validHours: number;
    /** The in-process finisher looks at every open landing address this often. */
    pollSeconds: number;
    /** A status page that waits for a landing asks the server to check again this often. */
    pagePollSeconds: number;
    /** Convert attempts per coin when a pool is spent between build and broadcast. */
    finishAttempts: number;
    /** An address that received nothing for this many days is no longer watched (its card still works). */
    idleDays: number;
  };
  limits: {
    minUsd: number;
    localMinSats: number;
    maxUsd: number;
    judgeLandBch: string;
    judgeSwapBch: string;
    judgeOutToken: Record<RouteId, string>;
    routeMinUsd: Record<RouteId, number>;
    /** Above this share of the amount, the page says fees are high and suggests a larger amount. */
    feeWarnBps: number;
  };
  fees: { satsPerByte: number; capSats: number };
  rate: { quotesPerMinute: number; crossingsPerHour: number; cloudflareCidrs: string[] };
  compliance: { blockedCountries: string[]; crossChainEnabled: boolean };
  banner: { deckUrl: string; repoUrl: string; tokenAddress: string; note: boolean };
  /** `url` is the public origin; `ogImage` is the link preview picture under web/public. */
  site: { url: string; noindex: boolean; feedbackUrl: string; ogImage: string };
  ops: {
    healthIntervalSeconds: number;
    /** Addresses of the project's own test wallet: their crossings are counted as `test`, not `public`. */
    testAddresses: string[];
    quotePayloadHours: number;
  };
}

/** The part of the config the page needs. Everything else stays on the server. */
export interface PublicConfig {
  tokens: Record<string, TokenConfig>;
  defaultToken: string;
  features: SampanConfig['features'];
  route: SampanConfig['route'];
  /** Destination chains the active route carries (keys of evm.chains). */
  routeChains: string[];
  evm: { chains: EvmChainConfig[]; walletConnect: boolean };
  limits: SampanConfig['limits'];
  landing: Pick<SampanConfig['landing'], 'toleranceBpsDirect' | 'returnAfterBlocks' | 'validHours' | 'pagePollSeconds'>;
  compliance: { crossChainEnabled: boolean };
  banner: SampanConfig['banner'];
  site: SampanConfig['site'];
  connect: SampanConfig['connect'] & { gapLimit: number; feeCapSats: number };
}

const HEX32 = /^[0-9a-fA-F]{64}$/;
const ROUTES: readonly ActiveRoute[] = ['none', 'near-intents', 'thorchain'];

function isHttpsUrl(value: string): boolean {
  return /^https:\/\/[^\s]+$/.test(value);
}

/** Returns a list of problems; an empty list means the config can be used. */
const MAX_SCAN_CACHE_SECONDS = 60;

export function validateConfig(c: SampanConfig): string[] {
  const errors: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) errors.push(message);
  };
  const posInt = (v: number): boolean => Number.isInteger(v) && v > 0;

  const tokens = Object.entries(c.tokens ?? {});
  need(tokens.length > 0, 'tokens: at least one token');
  for (const [key, t] of tokens) {
    need(t.symbol === key, `tokens.${key}: symbol must equal its key`);
    need(HEX32.test(t.category), `tokens.${key}: category must be 64 hex characters`);
    need(Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 18, `tokens.${key}: decimals 0 to 18`);
  }
  need(Boolean(c.tokens?.[c.defaultToken]), 'defaultToken: must name a configured token');
  need(ROUTES.includes(c.route?.active), 'route.active: none, near-intents or thorchain');
  need(c.thorchain.nodes.length > 0 && c.thorchain.nodes.every(isHttpsUrl), 'thorchain.nodes: https URLs');
  need(posInt(c.thorchain.timeoutMs) && posInt(c.thorchain.maxGasRate), 'thorchain.timeoutMs, maxGasRate: positive integers');
  need(c.oneClick.baseUrl === '' || isHttpsUrl(c.oneClick.baseUrl), 'oneClick.baseUrl: empty or an https URL');
  need(c.route.active !== 'near-intents' || c.oneClick.baseUrl !== '', 'oneClick.baseUrl: required for near-intents');
  need(c.cauldron.indexers.length > 0 && c.cauldron.indexers.every(isHttpsUrl), 'cauldron.indexers: https URLs');
  need(c.electrum.servers.length >= 3, 'electrum.servers: at least three servers');
  need(c.electrum.indexWaitMs >= 0 && c.electrum.indexPollMs > 0, 'electrum.indexWaitMs >= 0 and indexPollMs > 0');
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
    c.limits.feeWarnBps,
  ];
  need(bps.every((v) => Number.isInteger(v) && v >= 0 && v < 10000), 'basis points: integers from 0 to 9999');
  need(c.limits.minUsd > 0 && c.limits.maxUsd > c.limits.minUsd, 'limits: 0 < minUsd < maxUsd');
  need(Number.isInteger(c.limits.localMinSats) && c.limits.localMinSats > 0, 'limits.localMinSats: positive integer');
  need(c.fees.satsPerByte >= 1, 'fees.satsPerByte: at least 1');
  need(Number.isInteger(c.fees.capSats) && c.fees.capSats >= 1000, 'fees.capSats: integer, at least 1000');
  need(posInt(c.cauldron.cacheSeconds) && posInt(c.cauldron.buildAttempts), 'cauldron.cacheSeconds, buildAttempts: positive integers');
  need(posInt(c.cauldron.maxPoolsPerTx), 'cauldron.maxPoolsPerTx: positive integer');
  need(
    posInt(c.wallet?.gapLimit) && c.wallet.maxAddressesPerScan >= c.wallet.gapLimit && posInt(c.wallet.scanCacheSeconds),
    'wallet: gapLimit, maxAddressesPerScan >= gapLimit, scanCacheSeconds',
  );
  // A wallet funded after its first scan must show the coins on the next connect, not minutes later.
  need(c.wallet.scanCacheSeconds <= MAX_SCAN_CACHE_SECONDS, `wallet.scanCacheSeconds: at most ${MAX_SCAN_CACHE_SECONDS}`);
  need(
    c.connect?.relayUrls.length > 0 && c.connect.relayUrls.every((u) => /^wss:\/\/[^\s/]+\/?$/.test(u)),
    'connect.relayUrls: wss URLs (host and port only)',
  );
  need(posInt(c.connect?.maxScanRounds), 'connect.maxScanRounds: positive integer');
  need(isHttpsUrl(c.connect?.explorerTxUrl ?? '') && c.connect.explorerTxUrl.includes('{txid}'), 'connect.explorerTxUrl: https URL with {txid}');
  need(posInt(c.rate.quotesPerMinute) && posInt(c.rate.crossingsPerHour), 'rate: positive integers');
  need(c.rate.cloudflareCidrs.every((r) => /^[0-9a-fA-F:.]+\/\d{1,3}$/.test(r)), 'rate.cloudflareCidrs: CIDR ranges');
  const l = c.landing;
  need(
    [l.convertFeeSats, l.validHours, l.pollSeconds, l.pagePollSeconds, l.finishAttempts, l.idleDays, l.tokenDustSats, l.returnAfterBlocks].every(posInt),
    'landing: convertFeeSats, validHours, pollSeconds, pagePollSeconds, finishAttempts, idleDays, tokenDustSats, returnAfterBlocks: positive integers',
  );
  need(l.convertFeeSats + l.tokenDustSats < c.limits.localMinSats, 'landing: convertFeeSats + tokenDustSats below limits.localMinSats');
  need(posInt(c.ops.quotePayloadHours), 'ops.quotePayloadHours: positive integer');
  need(c.ops.testAddresses.every((a) => a.startsWith('bitcoincash:') || a.startsWith('bchtest:')), 'ops.testAddresses: cash addresses');
  need(c.ops.healthIntervalSeconds >= 30, 'ops.healthIntervalSeconds: at least 30');
  need(c.compliance.blockedCountries.every((cc) => /^[A-Z]{2}$/.test(cc)), 'compliance.blockedCountries: ISO codes');
  need(isHttpsUrl(c.site.url) && !c.site.url.endsWith('/'), 'site.url: https origin without a trailing slash');
  need(/^\/[\w.-]+\.png$/.test(c.site.ogImage), 'site.ogImage: a /name.png path under web/public');
  for (const url of [c.banner.deckUrl, c.banner.repoUrl, c.site.feedbackUrl]) {
    need(url === '' || isHttpsUrl(url) || url.startsWith('/'), `URL must be empty, a path or https: ${url}`);
  }
  return errors;
}

/** Token categories are case-insensitive hex; the rest of the code compares them in lowercase. */
/**
 * SAMPAN_CONFIG_PATCH: JSON merged over the config file (objects merge, everything else replaces). Used by the
 * e2e run to switch on unmeasured flows and lift rate limits; the result is validated like the file itself.
 */
export function patchConfig(c: SampanConfig, patch: string | undefined): SampanConfig {
  if (!patch) return c;
  const merge = (base: unknown, over: unknown): unknown => {
    if (!over || typeof over !== 'object' || Array.isArray(over) || !base || typeof base !== 'object' || Array.isArray(base)) return over;
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(over)) {
      if (!(k in out)) throw new Error(`SAMPAN_CONFIG_PATCH: unknown key ${k}`);
      out[k] = merge(out[k], v);
    }
    return out;
  };
  return merge(c, JSON.parse(patch)) as SampanConfig;
}

export function normalizeConfig(c: SampanConfig): SampanConfig {
  const tokens = Object.fromEntries(
    Object.entries(c.tokens).map(([key, t]) => [key, { ...t, category: t.category.toLowerCase() }]),
  );
  return { ...c, tokens };
}

export function publicConfig(c: SampanConfig): PublicConfig {
  return {
    tokens: Object.fromEntries(
      Object.entries(c.tokens).filter(([key]) => key === c.defaultToken || (key === 'MUSD' && c.features.musd)),
    ),
    defaultToken: c.defaultToken,
    features: c.features,
    route: c.route,
    routeChains: c.route.active === 'thorchain' ? c.thorchain.chains : c.route.active === 'near-intents' ? c.oneClick.chains.map((k) => k.toUpperCase()) : [],
    evm: { chains: c.evm.chains, walletConnect: c.evm.walletConnectProjectId !== '' },
    limits: c.limits,
    landing: {
      toleranceBpsDirect: c.landing.toleranceBpsDirect,
      returnAfterBlocks: c.landing.returnAfterBlocks,
      validHours: c.landing.validHours,
      pagePollSeconds: c.landing.pagePollSeconds,
    },
    compliance: { crossChainEnabled: c.compliance.crossChainEnabled },
    banner: c.banner,
    site: c.site,
    connect: { ...c.connect, gapLimit: c.wallet.gapLimit, feeCapSats: c.fees.capSats },
  };
}
