// Route A, used as a second route next to THORChain: the NEAR Intents 1Click API (ADR 0048, ADR 0049). A real quote
// (dry: false) carries the person's own refund address and returns a one-time deposit address; the BCH deposit pays it
// the exact amountIn with change back to input 0 and no memo (checkTransaction rule 6, two outputs). Bringing tokens in
// is one plain ERC-20 transfer to the deposit address. Quotes the page shows while typing are dry, to addresses nobody
// holds; a real quote to such an address is refused here (terms 4.1(h)). Status is asked by deposit address.
import { parseAddress } from '../../core/address.js';
import { isPlaceholder, type OneClickConfig } from '../../core/oneclick-config.js';
import { buildDeposit } from '../../core/tx/deposit.js';
import { openMapOf, type OpenMap } from '../../core/route-assets.js';
import type { WalletCoin } from '../../core/tx/payment.js';
import { OneClickError, type OneClickApi, type QuoteBody, type QuoteRequest, type StatusResponse } from './oneclick-api.js';
import { RouteError, type CrossingStatus, type InPlan, type InQuote, type InRequest, type OutQuote, type OutRequest, type Route, type RouteFees } from './types.js';

export interface OneClickOptions {
  api: OneClickApi;
  config: OneClickConfig;
  /** The site's own floor for the deposit fee rate (1Click names none for BCH). */
  minSatsPerByte: bigint;
  now?: () => number;
}

const UNITS = /^[0-9]+$/;

const units = (v: string | undefined, what: string): bigint => {
  if (v === undefined || !UNITS.test(v)) throw new RouteError('route_unavailable', `1Click quote has no ${what}`);
  return BigInt(v);
};

/** 1Click reports one fee in the output asset (withdrawFee, already taken from amountOut); the rest is in the rate. */
const feesOf = (q: QuoteBody, out: bigint): RouteFees => {
  const withdraw = q.withdrawFee !== undefined && UNITS.test(q.withdrawFee) ? BigInt(q.withdrawFee) : 0n;
  const gross = out + withdraw;
  return {
    total: withdraw,
    totalBps: gross > 0n ? Number((withdraw * 10_000n) / gross) : 0,
    liquidity: 0n,
    outbound: withdraw,
    affiliate: 0n,
    slippageBps: 0,
  };
};

const STAGES: Record<StatusResponse['status'], CrossingStatus['stage']> = {
  PENDING_DEPOSIT: 'unseen',
  INCOMPLETE_DEPOSIT: 'unseen',
  KNOWN_DEPOSIT_TX: 'pending',
  PROCESSING: 'pending',
  SUCCESS: 'done',
  REFUNDED: 'refunded',
  FAILED: 'failed',
};

export class OneClickRoute implements Route {
  readonly id = 'near-intents' as const;
  constructor(private readonly o: OneClickOptions) {}

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private decimalsOf(id: string): number {
    const a = this.o.config.assets.find((x) => x.id === id);
    if (!a) throw new RouteError('bad_request', 'that asset is not offered on this route');
    return a.decimals;
  }

  /** A dry quote while `refundTo` is absent; a real one (with a deposit address) when it is given. */
  private async ask(dir: 'out' | 'in', from: string, to: string, amount: bigint, recipient: string, refundTo: string | undefined): Promise<QuoteBody & { deadlineSec: number }> {
    const real = refundTo !== undefined;
    if (real && (isPlaceholder(this.o.config, refundTo) || isPlaceholder(this.o.config, recipient)))
      throw new RouteError('placeholder_address', 'a real quote needs your own addresses');
    const deadlineMs = this.now() + this.o.config.deadlineMinutes[dir] * 60_000;
    const request: QuoteRequest = {
      dry: !real,
      swapType: 'EXACT_INPUT',
      slippageTolerance: this.o.config.slippageBps,
      originAsset: from,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: to,
      amount: amount.toString(),
      refundTo: refundTo ?? this.o.config.placeholders[dir === 'out' ? 'bch' : 'evm'],
      refundType: 'ORIGIN_CHAIN',
      recipient,
      recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(deadlineMs).toISOString(),
    };
    let q: QuoteBody;
    try {
      q = (await this.o.api.quote(request)).quote;
    } catch (e) {
      if (e instanceof OneClickError && !e.unreachable) throw new RouteError('bad_request', `1Click: ${e.message}`);
      throw new RouteError('route_unavailable', '1Click is not answering');
    }
    if (q.depositMemo) throw new RouteError('route_unavailable', '1Click asked for a memo, which this route does not send');
    if (real && !q.depositAddress) throw new RouteError('route_unavailable', '1Click quote has no deposit address');
    if (units(q.amountIn, 'input amount') !== amount) throw new RouteError('route_unavailable', '1Click quoted a different input amount');
    const answered = q.deadline ? Date.parse(q.deadline) : NaN;
    const deadlineSec = Math.floor((Number.isFinite(answered) ? Math.min(answered, deadlineMs) : deadlineMs) / 1000);
    if (deadlineSec * 1000 <= this.now()) throw new RouteError('route_unavailable', '1Click quote has already expired');
    return { ...q, deadlineSec };
  }

  async quoteOut(r: OutRequest): Promise<OutQuote> {
    const decimals = this.decimalsOf(r.asset);
    const q = await this.ask('out', this.o.config.bchAsset, r.asset, r.sats, r.destination, r.refundTo);
    const expectedOut = units(q.amountOut, 'output amount');
    return {
      route: this.id,
      sats: r.sats,
      // A dry quote has no deposit address; the placeholder keeps the shape and can never be paid (build refuses it).
      vault: q.depositAddress ?? this.o.config.placeholders.bch,
      memo: '',
      asset: r.asset,
      destination: r.destination,
      expectedOut,
      minOut: units(q.minAmountOut, 'minimum output'),
      outDecimals: decimals,
      fees: feesOf(q, expectedOut),
      recommendedMinSats: 0n,
      satsPerByte: this.o.minSatsPerByte,
      expiry: q.deadlineSec,
      seconds: q.timeEstimate ?? 0,
    };
  }

  buildOut(q: OutQuote, coins: WalletCoin[]) {
    if (isPlaceholder(this.o.config, q.vault)) throw new RouteError('placeholder_address', 'a dry quote cannot be paid');
    const vault = parseAddress(q.vault, 'bitcoincash');
    if (typeof vault === 'string') throw new RouteError('route_unavailable', 'the deposit address is not usable');
    return buildDeposit({ coins, vaultLockingHex: vault.lockingHex, sats: q.sats, memo: '', satsPerByte: q.satsPerByte });
  }

  async quoteIn(r: InRequest): Promise<InQuote> {
    const decimals = this.decimalsOf(r.asset);
    // The page counts stablecoins in 1e8 units; 1Click counts them in the token's own decimals.
    const tokenUnits = decimals >= 8 ? r.amount * 10n ** BigInt(decimals - 8) : r.amount / 10n ** BigInt(8 - decimals);
    if (tokenUnits <= 0n) throw new RouteError('bad_request', 'amount must be positive');
    const q = await this.ask('in', r.asset, this.o.config.bchAsset, tokenUnits, r.destination, r.refundTo);
    const expectedSats = units(q.amountOut, 'output amount');
    return {
      route: this.id,
      asset: r.asset,
      amount: r.amount,
      destination: r.destination,
      expectedSats,
      minSats: units(q.minAmountOut, 'minimum output'),
      router: '',
      vault: q.depositAddress ?? this.o.config.placeholders.evm,
      memo: '',
      fees: feesOf(q, expectedSats),
      expiry: q.deadlineSec,
      seconds: q.timeEstimate ?? 0,
    };
  }

  buildIn(q: InQuote): InPlan {
    if (isPlaceholder(this.o.config, q.vault)) throw new RouteError('placeholder_address', 'a dry quote cannot be paid');
    const decimals = this.decimalsOf(q.asset);
    const amount = decimals >= 8 ? q.amount * 10n ** BigInt(decimals - 8) : q.amount / 10n ** BigInt(8 - decimals);
    return { kind: 'transfer', vault: q.vault, asset: q.asset, amount, expiry: q.expiry };
  }

  async status(_txid: string, depositAddress?: string): Promise<CrossingStatus> {
    if (!depositAddress) throw new RouteError('bad_request', '1Click status needs the deposit address');
    let s: StatusResponse;
    try {
      s = await this.o.api.status(depositAddress);
    } catch {
      throw new RouteError('route_unavailable', '1Click is not answering');
    }
    const stage = STAGES[s.status];
    if (!stage) throw new RouteError('route_unavailable', '1Click sent an unknown status');
    const sent = stage === 'done' ? s.swapDetails?.destinationChainTxHashes?.[0]?.hash : undefined;
    return { stage, ...(sent ? { outTxid: sent } : {}) };
  }

  async submit(txid: string, depositAddress: string): Promise<void> {
    await this.o.api.submit(txid, depositAddress);
  }

  /** 1Click reports no per-chain halt; the chains of its configured assets count as open, BCH included. */
  async open(): Promise<OpenMap> {
    return openMapOf([{ chain: 'BCH' }, ...this.o.config.assets.map((a) => ({ chain: a.chain }))]);
  }

  async gasAssetUsd(): Promise<bigint | null> {
    return null;
  }
}
