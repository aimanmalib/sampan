// Shape of config/sampan.json and the checks run when it is loaded.
// Pure: no I/O. The server reads the file; the page receives the public part from /api/config.
import { validateAtom, type AtomConfig } from './atom-config.js';
import { oneClickPublic, validateOneClick, type OneClickConfig, type OneClickPublic } from './oneclick-config.js';
import { validateBusiness, type BusinessConfig } from './business.js';
import { validatePay, type PayConfig } from './pay/config.js';
import { nostrIdPublic, validateNostrId, type NostrIdConfig } from './nostr-config.js';
import { validatePeg, type PegConfig } from './peg.js';
import { validateActivity, type ActivityConfig } from './activity.js';
import { validateDemo, validateMedia, type DemoConfig, type MediaConfig } from './demo.js';
import { validateKeep, type KeepConfig } from './keep.js';
import { chainsOf, liveAssets, symbolsOf, validateAssets, validateEvmChain, type EvmChain, type RouteAsset } from './route-assets.js';
import { HERO_PROOF_KINDS, type HeroProofKind } from './hero-proof.js';

export type RouteId = 'near-intents' | 'thorchain';
export type ActiveRoute = RouteId | 'none';

export interface TokenConfig {
  symbol: string;
  name: string;
  category: string;
  decimals: number;
  icon: string;
}

export type EvmChainConfig = EvmChain;

/**
 * One section of /terms or /risks. `cross`: shown only while cross-chain flows are open. `oneClick`: shown only while
 * features.oneClick is true. `list`: item names rendered as a list under the text (`<kind>.<key>.list.<item>`).
 * `verbatim`: one part quoted in English in every language, with the translation under it (`<kind>.<key>.<verbatim>`).
 */
export interface LegalSection {
  key: string;
  cross?: boolean;
  oneClick?: boolean;
  list?: string[];
  verbatim?: string;
}

export interface SampanConfig {
  tokens: Record<string, TokenConfig>;
  defaultToken: string;
  /** A flow stays hidden until it has been measured on mainnet (SAMPAN_CONFIG_PATCH can switch it on for tests). */
  features: { musd: boolean; swap: boolean; landing: boolean; pay: boolean; atom: boolean; oneClick: boolean; nostrSend: boolean; watchDemo: boolean; keepCompare: boolean; demo: boolean };
  /** symbols: the symbols of the live thorchain.assets, repeated here and checked against them (texts name them). */
  route: { active: ActiveRoute; symbols: string[] };
  thorchain: {
    nodes: string[];
    /** The one list of stablecoins the route carries; each is offered only where live and its chain open. */
    assets: RouteAsset[];
    slippageBps: number;
    timeoutMs: number;
    /** Highest deposit fee rate (sat/byte) a quote may ask for; also the rate used to reserve fees. */
    maxGasRate: number;
    affiliate: string;
    affiliateBps: number;
    /** THORChain explorer page of one transaction, with {txid} (the receipt on /c/:id links the route's leg). */
    explorerTxUrl: string;
  };
  /** NEAR Intents 1Click as a second route (core/oneclick-config.ts); the server only, shown while features.oneClick is true. */
  oneClick: OneClickConfig;
  /** Finding and checking a Nostr identity's BCH address in the page (core/nostr-config.ts); used while features.nostrSend is true. */
  nostrId: NostrIdConfig;
  evm: {
    chains: EvmChainConfig[];
    /** Reown project id for WalletConnect; empty = the option is not offered and its code is never loaded. */
    walletConnectProjectId: string;
    /** The WalletConnect relay (the only origin added to connect-src when the option is on). */
    walletConnectRelay: string;
    /** WalletConnect Verify: its attestation frame lets the wallet show that a pairing comes from this domain (frame-src). */
    walletConnectVerify: string;
    /** How often the page asks the EVM wallet for a receipt, and how long it waits for an approval to confirm. */
    receiptPollSeconds: number;
    receiptWaitSeconds: number;
    /** A plan older than this is asked for again before the deposit is signed. */
    replanSeconds: number;
  };
  /** The atomic swap route (core/atom-config.ts); shown only while features.atom is true. */
  atom: AtomConfig;
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
  connect: {
    relayUrls: string[];
    maxScanRounds: number;
    explorerTxUrl: string;
    /** Seconds of "Waiting for your wallet" before the page offers to start again with a new link. */
    retryHintSeconds: number;
    /** Average BCH block time, for the cost card's time estimate. */
    bchBlockSeconds: number;
  };
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
    /** Arrivals below about this many sats are too small to give back after fees (dust); /risks says so. */
    dustSats: number;
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
  rate: { quotesPerMinute: number; crossingsPerHour: number; invoicesPerHour: number; cloudflareCidrs: string[] };
  compliance: { blockedCountries: string[]; crossChainEnabled: boolean };
  banner: { deckUrl: string; repoUrl: string; tokenAddress: string; note: boolean };
  /** The "Judging?" box on the front page. `openOnPhone`: its steps start unfolded on every screen; on a phone they
   *  sit right under the card so the card's primary button stays on the first screen (false = folded, as before). */
  judge: { openOnPhone: boolean };
  /** `url` is the public origin; `ogImage` is the link preview picture under web/public; `proofRuns` = rows of the
   *  newest measured runs on /how (the full list is docs/MEASURED.md); `finished` = the BCH transaction id of one
   *  measured crossing per direction that Send out and Bring in link to ("" = no link); `watch` = the replay on
   *  /watch?dir=land: `land` the BCH transaction id of one measured landing run ("" = no page), `stepMs` each step's length. */
  site: {
    url: string;
    noindex: boolean;
    feedbackUrl: string;
    ogImage: string;
    proofRuns: number;
    finished: { out: string; in: string };
    watch: { land: string; stepMs: number };
  };
  /** /terms and /risks: who runs the site and which sections to show (text in lang/ under terms.<key>.* and risks.<key>.*). */
  legal: { operator: string; terms: LegalSection[]; risks: LegalSection[] };
  ops: {
    healthIntervalSeconds: number;
    /** Sooner re-check while any health probe is down (a container start can race the first connections). */
    healthRetrySeconds: number;
    /** The page gives up on an API request after this long and says the server is not answering. */
    requestTimeoutSeconds: number;
    /** Addresses of the project's own test wallet: their crossings are counted as `test`, not `public`. */
    testAddresses: string[];
    quotePayloadHours: number;
  };
  business: BusinessConfig;
  /** PUSD peg guard (core/peg.ts): warning and refusal thresholds against THORChain's BCH price. */
  peg: PegConfig;
  pay: PayConfig;
  /** "You keep" per network before signing (features.keepCompare): how many networks are quoted and after what pause. */
  keepCompare: KeepConfig;
  /** "My activity": how many addresses one request asks about and how many crossings come back. */
  activity: ActivityConfig;
  /** The /demo page (features.demo): the videos on the media host, poster and tracks on this site, the owner's own upload link. */
  demo: DemoConfig;
  /** The second host name that serves the video files (/media/*), so video never goes through the site's CDN. */
  media: MediaConfig;
  /** The front page's "Measured" card: `proof` = counts from docs/MEASURED.md made when the page is built (the same counter as
   *  the README bounty table), with this server's own records as a small second line; `stats` = the server's records only. */
  measured: MeasuredConfig;
  quote: QuoteConfig;
  /**
   * How the status pages draw; not a flow. ferryMotion: the ferry on every status page and the landing card, moving while a step is under way.
   * qrAutoOpen: the landing card opens the address and shows its QR as soon as the owner is known (false = the "Get my landing address" button).
   * qrCloseMs: once a payment is seen, how long the QR code takes to close before the ferry moves (150 to 1500).
   * arriveMs: how long the one arrival animation plays once the token has landed (800 to 6000).
   * themes: the looks the build carries, each web/src/themes/<name>.css; always includes "paper", the way back.
   * theme: the one the page wears, written into <html data-theme> when the page is built.
   * icons: token symbol or chain key → icon file web/src/icons/<file>.svg; a name not listed gets a one-letter monogram.
   * hero: the front page's top, one of HERO_KINDS.
   * heroProof: the proof line by the card (K6P6), one of HERO_PROOF_KINDS: "latest-in" = the newest ok stablecoin crossing
   * into PUSD from docs/MEASURED.md, "none" = no line.
   * heroTab: the card's tab before a visitor picks one (swap, in or out); a tab that is not open falls back to the first.
   */
  ui: {
    ferryMotion: boolean;
    qrAutoOpen: boolean;
    qrCloseMs: number;
    arriveMs: number;
    themes: string[];
    theme: string;
    icons: Record<string, string>;
    hero: (typeof HERO_KINDS)[number];
    heroProof: HeroProofKind;
    heroTab: HeroTab;
  };
  /** Languages the page offers, in menu order, each by its own name; every code has a lang/<code>.json. default: shown until a visitor picks one. */
  i18n: I18nConfig;
}

export interface I18nConfig {
  default: string;
  /** `machine`: the lang file was translated with software and no speaker has checked it yet (the footer says so). */
  languages: { code: string; name: string; machine?: boolean }[];
}

/** The part of the config the page needs. Everything else stays on the server. */
export interface PublicConfig {
  tokens: Record<string, TokenConfig>;
  defaultToken: string;
  features: SampanConfig['features'];
  /** symbols: derived from the live assets of the active route (texts name them). */
  route: SampanConfig['route'];
  /** Assets live in at least one direction; the server still refuses one whose chain the route reports closed. */
  routeAssets: RouteAsset[];
  /** Chains of routeAssets (keys of evm.chains). */
  routeChains: string[];
  /** thorchain.explorerTxUrl: the receipt's THORChain link (/c/:id); the rest of thorchain stays on the server. */
  routeExplorerTxUrl: string;
  evm: { chains: EvmChainConfig[]; walletConnect: { projectId: string; relayUrl: string } | null } & Pick<SampanConfig['evm'], 'receiptPollSeconds' | 'receiptWaitSeconds' | 'replanSeconds'>;
  limits: SampanConfig['limits'];
  landing: Pick<SampanConfig['landing'], 'toleranceBps' | 'toleranceBpsDirect' | 'returnAfterBlocks' | 'validHours' | 'pagePollSeconds' | 'dustSats' | 'convertFeeSats'>;
  compliance: { crossChainEnabled: boolean };
  banner: SampanConfig['banner'];
  judge: SampanConfig['judge'];
  site: SampanConfig['site'];
  legal: SampanConfig['legal'];
  connect: SampanConfig['connect'] & { gapLimit: number; feeCapSats: number; satsPerByte: number; tokenDustSats: number };
  /** How often the page asks GET /api/health again: intervalSeconds, or retrySeconds while something is not ok;
   *  and how long it waits on any API request before it says the server is not answering. */
  health: { intervalSeconds: number; retrySeconds: number; requestTimeoutSeconds: number };
  /** The page rebuilds the expected Sampan fee output from these two values. */
  business: Pick<BusinessConfig, 'feeBps' | 'feeAddress'>;
  peg: PegConfig;
  /** Sampan Pay as its pages show it: how long an invoice is open, the invoice range and the demo shop's price. */
  pay: Pick<PayConfig, 'validMinutes' | 'minUsd' | 'maxUsd'> & { demoPriceUsd: number };
  keepCompare: KeepConfig;
  activity: ActivityConfig;
  demo: DemoConfig;
  measured: MeasuredConfig;
  quote: QuoteConfig;
  /** The atomic swap route's client file, contract and service path (the page loads nothing from it while features.atom is false). */
  atom: AtomConfig;
  /** 1Click as a second route: offered assets and timings only (core/oneclick-config.ts). */
  oneClick: OneClickPublic;
  /** Relays and timings for Nostr identities; null while features.nostrSend is false. */
  nostrId: NostrIdConfig | null;
  /** The page's look: which theme the built HTML wears (the list of themes stays in the file). */
  ui: Omit<SampanConfig['ui'], 'themes'>;
  i18n: I18nConfig;
}

export const MEASURED_SOURCES = ['proof', 'stats'] as const;
export interface MeasuredConfig { source: (typeof MEASURED_SOURCES)[number] }
/** The front page's top: `card` = one headline, live status chips, then the action card; `phone` = the earlier headline with its sentence (ADR 0071). */
export const HERO_KINDS = ['card', 'phone'] as const;
export const HERO_TABS = ['swap', 'in', 'out'] as const;
export type HeroTab = (typeof HERO_TABS)[number];
/** autoRefreshMs: how often a shown price asks again while the tab is visible and no dialog is open (0 = never; else 2000 to 60000). */
export interface QuoteConfig { autoRefreshMs: number }

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
  need(isHttpsUrl(c.thorchain.explorerTxUrl) && c.thorchain.explorerTxUrl.includes('{txid}'), 'thorchain.explorerTxUrl: an https URL with {txid}');
  errors.push(...validateOneClick(c.oneClick, c.evm.chains));
  need(c.route.active !== 'near-intents' || c.oneClick.baseUrl !== '', 'oneClick.baseUrl: required for near-intents');
  need(
    posInt(c.oneClick.minOutDeadlineBchBlocks) && c.oneClick.deadlineMinutes.out * 60 >= c.oneClick.minOutDeadlineBchBlocks * c.connect.bchBlockSeconds,
    'oneClick.deadlineMinutes.out: at least oneClick.minOutDeadlineBchBlocks average BCH blocks (connect.bchBlockSeconds)',
  );
  need(c.cauldron.indexers.length > 0 && c.cauldron.indexers.every(isHttpsUrl), 'cauldron.indexers: https URLs');
  need(c.electrum.servers.length >= 3, 'electrum.servers: at least three servers');
  need(c.electrum.indexWaitMs >= 0 && c.electrum.indexPollMs > 0, 'electrum.indexWaitMs >= 0 and indexPollMs > 0');
  need(c.evm.chains.length > 0, 'evm.chains: at least one chain');
  need(new Set(c.evm.chains.map((ch) => ch.key)).size === c.evm.chains.length, 'evm.chains: keys must differ');
  for (const ch of c.evm.chains) errors.push(...validateEvmChain(ch, isHttpsUrl));
  need(/^[0-9a-f]{32}$|^$/.test(c.evm.walletConnectProjectId), 'evm.walletConnectProjectId: 32 hex characters or empty');
  need(/^wss:\/\/[^\s/]+\/?$/.test(c.evm.walletConnectRelay), 'evm.walletConnectRelay: a wss URL (host only)');
  need(/^https:\/\/[^\s/]+\/?$/.test(c.evm.walletConnectVerify), 'evm.walletConnectVerify: an https URL (host only)');
  // One source for what the route carries: the old lists may not come back next to it.
  const liveSymbols = symbolsOf(liveAssets(c.thorchain.assets ?? []));
  need(
    Array.isArray(c.route?.symbols) && [...c.route.symbols].sort().join() === [...liveSymbols].sort().join(),
    `route.symbols: must be the symbols of the live thorchain.assets (${liveSymbols.join(', ') || 'none'})`,
  );
  need(!('chains' in (c.thorchain ?? {})), 'thorchain.chains: removed; thorchain.assets is the one list');
  errors.push(...validateAssets(c.thorchain.assets, c.evm.chains));
  need(
    c.evm.receiptPollSeconds > 0 && c.evm.receiptWaitSeconds >= c.evm.receiptPollSeconds && c.evm.replanSeconds > 0,
    'evm: receiptPollSeconds > 0, receiptWaitSeconds >= receiptPollSeconds, replanSeconds > 0',
  );
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
  need(posInt(c.connect?.retryHintSeconds), 'connect.retryHintSeconds: positive integer');
  need(posInt(c.connect?.bchBlockSeconds), 'connect.bchBlockSeconds: positive integer');
  need(isHttpsUrl(c.connect?.explorerTxUrl ?? '') && c.connect.explorerTxUrl.includes('{txid}'), 'connect.explorerTxUrl: https URL with {txid}');
  need(posInt(c.rate.quotesPerMinute) && posInt(c.rate.crossingsPerHour) && posInt(c.rate.invoicesPerHour), 'rate: positive integers');
  need(c.rate.cloudflareCidrs.every((r) => /^[0-9a-fA-F:.]+\/\d{1,3}$/.test(r)), 'rate.cloudflareCidrs: CIDR ranges');
  const l = c.landing;
  need(
    [l.convertFeeSats, l.validHours, l.pollSeconds, l.pagePollSeconds, l.finishAttempts, l.idleDays, l.tokenDustSats, l.returnAfterBlocks, l.dustSats].every(posInt),
    'landing: convertFeeSats, validHours, pollSeconds, pagePollSeconds, finishAttempts, idleDays, tokenDustSats, returnAfterBlocks, dustSats: positive integers',
  );
  need(l.convertFeeSats + l.tokenDustSats < c.limits.localMinSats, 'landing: convertFeeSats + tokenDustSats below limits.localMinSats');
  need(posInt(c.ops.quotePayloadHours), 'ops.quotePayloadHours: positive integer');
  need(c.ops.testAddresses.every((a) => a.startsWith('bitcoincash:') || a.startsWith('bchtest:')), 'ops.testAddresses: cash addresses');
  need(c.ops.healthIntervalSeconds >= 30, 'ops.healthIntervalSeconds: at least 30');
  need(
    posInt(c.ops.healthRetrySeconds) && c.ops.healthRetrySeconds <= c.ops.healthIntervalSeconds,
    'ops.healthRetrySeconds: positive integer, at most ops.healthIntervalSeconds',
  );
  need(typeof c.ui?.ferryMotion === 'boolean', 'ui.ferryMotion: true or false');
  need(typeof c.ui?.qrAutoOpen === 'boolean', 'ui.qrAutoOpen: true or false');
  const msIn = (v: unknown, lo: number, hi: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  need(msIn(c.ui?.qrCloseMs, 150, 1500), 'ui.qrCloseMs: an integer from 150 to 1500');
  need(msIn(c.ui?.arriveMs, 800, 6000), 'ui.arriveMs: an integer from 800 to 6000');
  const themes: unknown[] = Array.isArray(c.ui?.themes) ? c.ui.themes : [];
  need(
    themes.length > 0 && themes.every((t) => typeof t === 'string' && /^[a-z][a-z0-9-]*$/.test(t)) && new Set(themes).size === themes.length,
    'ui.themes: a list of distinct lower-case theme names',
  );
  need(themes.includes('paper'), 'ui.themes: must include "paper", the way back');
  need(typeof c.ui?.theme === 'string' && themes.includes(c.ui.theme), 'ui.theme: one of ui.themes');
  const icons: unknown = c.ui?.icons;
  need(
    typeof icons === 'object' && icons !== null && !Array.isArray(icons) &&
      Object.entries(icons).every(([k, v]) => /^[A-Za-z0-9.-]+$/.test(k) && typeof v === 'string' && /^[a-z0-9-]+$/.test(v)),
    'ui.icons: an object of name → icon file name (lower-case letters, digits, dashes)',
  );
  const langs = Array.isArray(c.i18n?.languages) ? c.i18n.languages : [];
  const codes = langs.map((x) => x?.code);
  need(
    langs.length > 0 && langs.every((x) => /^[a-z]{2,3}$/.test(x?.code ?? '') && typeof x.name === 'string' && x.name.trim() !== ''),
    'i18n.languages: { code, name } with a 2 or 3 letter lower-case code and a name',
  );
  need(langs.every((x) => x?.machine === undefined || typeof x.machine === 'boolean'), 'i18n.languages: machine is true or false');
  need(new Set(codes).size === codes.length && codes.includes('en'), 'i18n.languages: no code twice, and en (every key falls back to it)');
  need(codes.includes(c.i18n?.default), 'i18n.default: one of the i18n.languages codes');
  need(posInt(c.ops.requestTimeoutSeconds) && c.ops.requestTimeoutSeconds >= 10, 'ops.requestTimeoutSeconds: integer, at least 10');
  need(c.compliance.blockedCountries.every((cc) => /^[A-Z]{2}$/.test(cc)), 'compliance.blockedCountries: ISO codes');
  need(isHttpsUrl(c.site.url) && !c.site.url.endsWith('/'), 'site.url: https origin without a trailing slash');
  need(/^\/[\w.-]+\.png$/.test(c.site.ogImage), 'site.ogImage: a /name.png path under web/public');
  need(posInt(c.site.proofRuns) && c.site.proofRuns <= 30, 'site.proofRuns: 1 to 30');
  need(
    [c.site.finished?.out, c.site.finished?.in].every((id) => typeof id === 'string' && /^([0-9a-f]{64})?$/.test(id)),
    'site.finished.out and .in: a BCH transaction id in lower case hex, or ""',
  );
  need(typeof c.site.watch?.land === 'string' && /^([0-9a-f]{64})?$/.test(c.site.watch.land), 'site.watch.land: a BCH transaction id in lower case hex, or ""');
  need(posInt(c.site.watch?.stepMs) && c.site.watch.stepMs >= 400 && c.site.watch.stepMs <= 5000, 'site.watch.stepMs: integer, 400 to 5000');
  need(typeof c.legal?.operator === 'string' && c.legal.operator.trim() !== '', 'legal.operator: who runs the site');
  for (const list of [c.legal?.terms, c.legal?.risks]) {
    need(
      Array.isArray(list) && list.length > 0 && list.every((x) => /^[a-z][a-zA-Z]*$/.test(x?.key ?? '')) && new Set(list.map((x) => x.key)).size === list.length,
      'legal.terms, legal.risks: lists of unique { key } in camelCase',
    );
    for (const x of Array.isArray(list) ? list : []) {
      need(x?.cross === undefined || typeof x.cross === 'boolean', `legal section ${x?.key}: cross is true or false`);
      need(x?.oneClick === undefined || typeof x.oneClick === 'boolean', `legal section ${x?.key}: oneClick is true or false`);
      need(
        x?.list === undefined || (Array.isArray(x.list) && x.list.length > 0 && x.list.every((i) => /^[a-z][a-zA-Z]*$/.test(i)) && new Set(x.list).size === x.list.length),
        `legal section ${x?.key}: list is unique camelCase item names`,
      );
      need(x?.verbatim === undefined || /^[a-z][a-zA-Z]*$/.test(x.verbatim), `legal section ${x?.key}: verbatim is one camelCase part name`);
    }
  }
  for (const url of [c.banner.deckUrl, c.banner.repoUrl, c.site.feedbackUrl]) {
    need(url === '' || isHttpsUrl(url) || url.startsWith('/'), `URL must be empty, a path or https: ${url}`);
  }
  errors.push(...validateBusiness(c.business));
  errors.push(...validatePeg(c.peg));
  errors.push(...validatePay(c.pay));
  errors.push(...validateAtom(c.atom));
  need(typeof c.features?.atom === 'boolean', 'features.atom: true or false');
  need(typeof c.features?.oneClick === 'boolean', 'features.oneClick: true or false');
  need(typeof c.features?.nostrSend === 'boolean', 'features.nostrSend: true or false');
  need(typeof c.features?.watchDemo === 'boolean', 'features.watchDemo: true or false');
  need(typeof c.features?.keepCompare === 'boolean', 'features.keepCompare: true or false');
  errors.push(...validateKeep(c.keepCompare));
  errors.push(...validateActivity(c.activity));
  need(typeof c.features?.demo === 'boolean', 'features.demo: true or false');
  errors.push(...validateMedia(c.media, String(c.site?.url)));
  errors.push(...validateDemo(c.demo, String(c.media?.host)));
  need((MEASURED_SOURCES as readonly string[]).includes(String(c.measured?.source)), `measured.source: one of ${MEASURED_SOURCES.join(', ')}`);
  const refresh = c.quote?.autoRefreshMs;
  need(
    typeof refresh === 'number' && Number.isInteger(refresh) && (refresh === 0 || (refresh >= 2000 && refresh <= 60000)),
    'quote.autoRefreshMs: 0 (off) or an integer from 2000 to 60000',
  );
  need((HERO_KINDS as readonly string[]).includes(String(c.ui?.hero)), `ui.hero: one of ${HERO_KINDS.join(', ')}`);
  need((HERO_PROOF_KINDS as readonly string[]).includes(String(c.ui?.heroProof)), `ui.heroProof: one of ${HERO_PROOF_KINDS.join(', ')}`);
  need((HERO_TABS as readonly string[]).includes(String(c.ui?.heroTab)), `ui.heroTab: one of ${HERO_TABS.join(', ')}`);
  need(typeof c.judge?.openOnPhone === 'boolean', 'judge.openOnPhone: true or false');
  errors.push(...validateNostrId(c.nostrId));
  need(!c.features?.oneClick || c.oneClick.baseUrl !== '', 'oneClick.baseUrl: required while features.oneClick is true');
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

/** Assets the active route may offer: the live THORChain assets, or none for any other route. */
/** A token the server trades, lands and routes: the default token, and MUSD while its flag is on. */
export const tokenOffered = (c: Pick<SampanConfig, 'tokens' | 'defaultToken' | 'features'>, symbol: string): boolean =>
  c.tokens[symbol] !== undefined && (symbol === c.defaultToken || (symbol === 'MUSD' && c.features.musd));

export const routeAssetsOf = (c: SampanConfig): RouteAsset[] => (c.route.active === 'thorchain' ? liveAssets(c.thorchain.assets) : []);

export function publicConfig(c: SampanConfig): PublicConfig {
  const assets = routeAssetsOf(c);
  return {
    tokens: Object.fromEntries(
      Object.entries(c.tokens).filter(([key]) => tokenOffered(c, key)),
    ),
    defaultToken: c.defaultToken,
    features: c.features,
    route: { active: c.route.active, symbols: symbolsOf(assets) },
    routeAssets: assets,
    routeChains: chainsOf(assets),
    routeExplorerTxUrl: c.thorchain.explorerTxUrl,
    evm: {
      chains: c.evm.chains,
      walletConnect: c.evm.walletConnectProjectId === '' ? null : { projectId: c.evm.walletConnectProjectId, relayUrl: c.evm.walletConnectRelay },
      receiptPollSeconds: c.evm.receiptPollSeconds,
      receiptWaitSeconds: c.evm.receiptWaitSeconds,
      replanSeconds: c.evm.replanSeconds,
    },
    limits: c.limits,
    landing: {
      toleranceBps: c.landing.toleranceBps,
      toleranceBpsDirect: c.landing.toleranceBpsDirect,
      returnAfterBlocks: c.landing.returnAfterBlocks,
      validHours: c.landing.validHours,
      pagePollSeconds: c.landing.pagePollSeconds,
      dustSats: c.landing.dustSats,
      convertFeeSats: c.landing.convertFeeSats,
    },
    compliance: { crossChainEnabled: c.compliance.crossChainEnabled },
    banner: c.banner,
    judge: { openOnPhone: c.judge.openOnPhone },
    site: c.site,
    legal: c.legal,
    connect: { ...c.connect, gapLimit: c.wallet.gapLimit, feeCapSats: c.fees.capSats, satsPerByte: c.fees.satsPerByte, tokenDustSats: c.landing.tokenDustSats },
    health: { intervalSeconds: c.ops.healthIntervalSeconds, retrySeconds: c.ops.healthRetrySeconds, requestTimeoutSeconds: c.ops.requestTimeoutSeconds },
    business: { feeBps: c.business.feeBps, feeAddress: c.business.feeAddress },
    peg: { warnBps: c.peg.warnBps, refuseBps: c.peg.refuseBps },
    pay: { validMinutes: c.pay.validMinutes, minUsd: c.pay.minUsd, maxUsd: c.pay.maxUsd, demoPriceUsd: c.pay.demo.priceUsd },
    keepCompare: c.keepCompare,
    activity: c.activity,
    demo: c.demo,
    measured: { source: c.measured.source },
    quote: { autoRefreshMs: c.quote.autoRefreshMs },
    atom: c.atom,
    oneClick: oneClickPublic(c.oneClick),
    nostrId: nostrIdPublic(c.features.nostrSend, c.nostrId),
    ui: { ferryMotion: c.ui.ferryMotion, qrAutoOpen: c.ui.qrAutoOpen, qrCloseMs: c.ui.qrCloseMs, arriveMs: c.ui.arriveMs, theme: c.ui.theme, icons: c.ui.icons, hero: c.ui.hero, heroProof: c.ui.heroProof, heroTab: c.ui.heroTab },
    i18n: { default: c.i18n.default, languages: c.i18n.languages.map(({ code, name, machine }) => (machine ? { code, name, machine } : { code, name })) },
  };
}
