// One internal interface for the cross-chain route, one module per route. Only the active route is built
// (config route.active); the other route has no code that can reach its provider.
import type { RouteId } from '../../core/config.js';
import type { Payment, WalletCoin } from '../../core/tx/payment.js';

export class RouteError extends Error {
  constructor(
    readonly code: 'route_unavailable' | 'route_paused' | 'below_route_min' | 'bad_request',
    message: string,
  ) {
    super(message);
  }
}

/** A quote to send BCH out to another chain. Amounts in THORChain-style 1e8 units for the output side. */
export interface OutQuote {
  route: RouteId;
  /** BCH the deposit pays, in satoshis. */
  sats: bigint;
  /** Cash address (with prefix) of the vault or deposit address that receives `sats`. */
  vault: string;
  /** Memo as it goes on chain (with our limit), or '' for routes without a memo. */
  memo: string;
  /** Asset name as the route writes it, e.g. BASE.USDC-0X8335…. */
  asset: string;
  destination: string;
  expectedOut: bigint;
  minOut: bigint;
  outDecimals: number;
  fees: { total: bigint; totalBps: number };
  /** Smallest deposit the route recommends, in satoshis. */
  recommendedMinSats: bigint;
  satsPerByte: bigint;
  /** Unix seconds after which nothing may be sent against this quote. */
  expiry: number;
  /** The route's own estimate, seconds. */
  seconds: number;
}

/** A quote to bring a token from another chain in to a BCH address. */
export interface InQuote {
  route: RouteId;
  /** Source asset in route form, e.g. BASE.USDC-0X8335…. */
  asset: string;
  /** Source amount in the route's 1e8 units. */
  amount: bigint;
  destination: string;
  expectedSats: bigint;
  minSats: bigint;
  /** EVM router and vault the wallet calls; THORChain does not take plain token transfers. */
  router: string;
  vault: string;
  memo: string;
  expiry: number;
  seconds: number;
}

/** What an EVM wallet signs to bring tokens in (calldata is built in the page from these, P4b). */
export interface InPlan {
  kind: 'router-deposit';
  router: string;
  vault: string;
  asset: string;
  amount: bigint;
  memo: string;
  expiry: number;
}

export type CrossingStage = 'unseen' | 'pending' | 'done' | 'refunded';

export interface CrossingStatus {
  stage: CrossingStage;
  /** Transaction on the destination chain once the route has sent it. */
  outTxid?: string;
  outChain?: string;
}

export interface OutRequest {
  sats: bigint;
  /** Route form of the destination asset. */
  asset: string;
  destination: string;
}

export interface InRequest {
  asset: string;
  amount: bigint;
  /** BCH address (with prefix) that receives the BCH: the user's own or a landing address. */
  destination: string;
}

export interface Route {
  id: RouteId;
  quoteOut(r: OutRequest): Promise<OutQuote>;
  /** The deposit transaction for a fresh quote; the first coin is input 0. */
  buildOut(q: OutQuote, coins: WalletCoin[]): Payment;
  quoteIn(r: InRequest): Promise<InQuote>;
  buildIn(q: InQuote): InPlan;
  status(txid: string): Promise<CrossingStatus>;
  /** False when the route reports BCH or a destination chain halted. */
  open(chains: string[]): Promise<boolean>;
}
