// Types for the part of the atomic swap client that Sampan calls. The client is a byte copy of dist-client/atom-client.js
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
}

export interface AtomClientModule {
  shippedConfig(): AtomShippedConfig;
  makerApi(base: string): AtomMakerApi;
}
