// Types for the part of the atomic swap client that Sampan calls. The client is dist-client/atom-client.js, minified,
// built from the commit in config atom.clientCommit; these declarations follow client/index.ts, client/api.ts and
// client/types.ts at that commit. Only what Sampan uses is declared.

export type AtomFlow = 'usdc-to-pusd' | 'pusd-to-usdc';

export interface AtomHealthView {
  ok: boolean;
  mainnet: boolean;
  bchNetwork: string;
  chainId: number;
  atomLock: string;
}

type AtomFee = { chain: 'base'; gasUnits: number | null } | { chain: 'bch'; sats: number };
type AtomSpan = { chain: 'base'; seconds: number } | { chain: 'bch'; blocks: number };

export interface AtomQuoteView {
  ok: boolean;
  /** Why the maker would not take this amount now: inventory, below-min, above-max, daily-limit, or another code. */
  reason?: string;
  flow: AtomFlow;
  amountIn?: string;
  amountOut?: string;
  inventory: string;
  networkFees: { lock: AtomFee; claim: AtomFee };
  trust: { userLockReturnsAfter: AtomSpan; makerLockReturnsAfter: AtomSpan; confirmations: { bch: number; base: number } };
  limits: { minUsdPerSwap: number; maxUsdPerSwap: number; maxUsdPerDay: number; spreadBps: number };
  measured: { count: number; medianSeconds: number | null };
}

export interface AtomMakerApi {
  health(): Promise<AtomHealthView>;
  quote(flow: AtomFlow, amount: string): Promise<AtomQuoteView>;
}

/** The config the client was built with (config/atom.json at that commit), as far as Sampan reads it. */
export interface AtomShippedConfig {
  features: { mainnet: boolean };
  evm: { chainId: number; atomLock: string; rpcUrls: string[] };
  bch: { network: string };
  electrum: { servers: string[]; chipnetServers: string[]; timeoutMs: number };
  client: { apiPath: string; pollSeconds: number; storageKey: string };
  tokens: { pusd: { symbol: string }; usdc: { symbol: string } };
}

export type AtomSwapState = 'offered' | 'userLocked' | 'makerLocked' | 'secretSeen' | 'done' | 'refunded' | 'expired' | 'failed';

/** The service's view of one swap (client/types.ts SwapView); locks are passed back to the client untouched. */
export interface AtomSwapView {
  hash: string;
  flow: AtomFlow;
  state: AtomSwapState;
  amountIn: string;
  amountOut: string;
  symbolIn: string;
  symbolOut: string;
  lockBy: number;
  makerLock: unknown;
  declined: string | null;
  tx: Partial<Record<'userLock' | 'makerLock' | 'userClaim' | 'makerClaim' | 'makerRefund' | 'userRefund', string>>;
}

/** A recovery card as the client holds it; Sampan reads only the flow, the hash and the creation time. */
export interface AtomCard {
  flow: AtomFlow;
  createdUtc: string;
  secret: { hash: string };
}

/** One swap started in this browser (client/store.ts Saved). */
export interface AtomSaved {
  card: AtomCard;
  amountOut: bigint;
}

export interface AtomCardStore {
  list(): AtomSaved[];
}

export interface AtomSwapApi extends AtomMakerApi {
  swap(hash: string): Promise<AtomSwapView>;
}

/** What the swap functions need (client/swap.ts Deps); built once from the client's own pieces. */
export interface AtomDeps {
  config: AtomShippedConfig;
  api: AtomSwapApi;
  bch: () => Promise<unknown>;
  base: unknown;
  store: AtomCardStore;
}

export interface AtomEip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface AtomClientModule {
  shippedConfig(): AtomShippedConfig;
  makerApi(base: string): AtomMakerApi;
}

/** The same module with the functions that run a swap (client/swap.ts, client/store.ts, core/card.ts). */
export interface AtomSwapModule extends AtomClientModule {
  makerApi(base: string): AtomSwapApi;
  baseReader(config: AtomShippedConfig): unknown;
  connectElectrum(servers: string[], timeoutMs: number): Promise<unknown>;
  cardStore(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string): AtomCardStore;
  cardToJson(card: AtomCard): string;
  startSwap(d: AtomDeps, input: { flow: AtomFlow; amount: string; userBch: string; userEvm: string }): Promise<{ saved: AtomSaved; swap: AtomSwapView }>;
  lockOnBase(config: AtomShippedConfig, saved: AtomSaved, wallet: AtomEip1193, onStep?: (step: 'approve' | 'lock') => void): Promise<string>;
  makerLockReady(d: AtomDeps, saved: AtomSaved, swap: AtomSwapView): Promise<string | null>;
  claim(d: AtomDeps, saved: AtomSaved): Promise<AtomSwapView>;
  refundReady(d: AtomDeps, saved: AtomSaved): Promise<boolean>;
  amountInText(config: AtomShippedConfig, saved: AtomSaved): string;
  amountOutText(config: AtomShippedConfig, saved: AtomSaved): string;
}
