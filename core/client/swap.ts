// The swap as the page runs it: quote, build on the server, check the built transaction in the browser
// against what the user was shown, then ask the wallet to sign and send it through the server. A transaction
// that fails the check never reaches the wallet.
import { feeLockingHex, prefixOf, sampanFeeSats, type BusinessConfig } from '../business.js';
import { BCH, checkTransaction, type Expectation } from '../check.js';
import type { TradeSide } from '../pools/trade.js';
import { expectationFromWire, outputFromWire, txFromHex, type WireExpectation, type WireOutput } from '../wire.js';
import { ApiFailure, type Api } from './api.js';
import type { WalletView } from './scan.js';
import type { WalletSession } from './session.js';

export interface WireQuote {
  token: string;
  category: string;
  side: TradeSide;
  supply: string;
  demand: string;
  minReceive: string;
  sampanFeeSats: string;
  pools: number;
  usd: number;
}

export interface SwapIntent {
  token: string;
  side: TradeSide;
  /** What the user pays, in base units (satoshis for buy, token units for sell). */
  amount: bigint;
  /** The minimum the user was shown. */
  minReceive: bigint;
  category: string;
  feeCapSats: bigint;
  userPrompt: string;
  /** Sampan fee as this page's config states it; the check rebuilds the fee output from it. */
  business: Pick<BusinessConfig, 'feeBps' | 'feeAddress'>;
}

export type SwapStep = 'building' | 'checking' | 'signing' | 'sending';

export class CheckFailure extends Error {
  constructor(readonly rule: number, reason: string) {
    super(reason);
    this.name = 'CheckFailure';
  }
}

interface BuildReply {
  crossingId: string;
  tx: string;
  sourceOutputs: WireOutput[];
  inputPaths: Array<{ inputIndex: number; path: string }>;
  feeSats: string;
  quote: WireQuote;
  expectation: WireExpectation;
}

export const quoteSwap = async (api: Api, q: { token: string; side: TradeSide; amount: bigint }): Promise<WireQuote> =>
  (await api.post<{ quote: WireQuote }>('/api/swap/quote', { token: q.token, side: q.side, amount: q.amount.toString() })).quote;

/**
 * The expectation the browser enforces. Only the pool list and the input paths come from the server; the
 * user's own addresses, the amounts and the fee cap come from this page.
 */
export function browserExpectation(build: BuildReply, wallet: WalletView, intent: SwapIntent): Expectation {
  const server = expectationFromWire(build.expectation);
  const { feeBps, feeAddress } = intent.business;
  const feeLock = feeLockingHex(intent.business, prefixOf(feeAddress));
  const buyFee = intent.side === 'buy' ? sampanFeeSats(intent.amount, feeBps) : 0n;
  return {
    userLockingBytecodes: wallet.derived.map((a) => a.lockingHex),
    inputPaths: build.inputPaths,
    poolOwnerPkhs: server.poolOwnerPkhs,
    spend: intent.side === 'buy' ? { sats: intent.amount + buyFee, tokens: {} } : { sats: 0n, tokens: { [intent.category.toLowerCase()]: intent.amount } },
    feeCapSats: intent.feeCapSats,
    receive: { category: intent.side === 'buy' ? intent.category.toLowerCase() : BCH, min: intent.minReceive },
    ...(feeLock ? { sampanFee: { lockingBytecode: feeLock, bps: feeBps } } : {}),
  };
}

/** Input paths must name the address whose coin the input spends. */
function pathsMatchCoins(build: BuildReply, wallet: WalletView): boolean {
  return build.inputPaths.every((p) => {
    const src = build.sourceOutputs[p.inputIndex];
    const addr = wallet.derived.find((a) => `${a.path}/${a.index}` === p.path);
    return !!src && !!addr && src.lockingBytecode === addr.lockingHex;
  });
}

export async function runSwap(o: {
  api: Api;
  session: WalletSession;
  wallet: WalletView;
  intent: SwapIntent;
  onStep?: (step: SwapStep) => void;
}): Promise<{ crossingId: string; txid: string; feeSats: bigint }> {
  const { api, session, wallet, intent } = o;
  const spendable = wallet.coins.filter((c) => !c.token?.nft);
  // Coins to pick from, plus the payout and change addresses (the server only pays addresses listed here).
  const listed = [...spendable.map((c) => c.address), wallet.receive, wallet.change];
  const addresses = [...new Map(listed.map((a) => [a.address, { address: a.address, path: `${a.path}/${a.index}` }])).values()];
  const payout = intent.side === 'buy' ? wallet.receive.tokenAddress : wallet.receive.address;
  const change = intent.side === 'sell' ? wallet.change.tokenAddress : wallet.change.address;
  if (payout !== wallet.receive.address) addresses.push({ address: payout, path: `${wallet.receive.path}/${wallet.receive.index}` });
  if (change !== wallet.change.address) addresses.push({ address: change, path: `${wallet.change.path}/${wallet.change.index}` });
  let crossingId: string | undefined;
  for (;;) {
    o.onStep?.('building');
    const build = await api.post<BuildReply>('/api/swap/build', {
      token: intent.token,
      side: intent.side,
      amount: intent.amount.toString(),
      minReceive: intent.minReceive.toString(),
      addresses,
      payoutAddress: payout,
      changeAddress: change,
      ...(crossingId ? { crossingId } : {}),
    });
    crossingId = build.crossingId;
    o.onStep?.('checking');
    if (!pathsMatchCoins(build, wallet)) throw new CheckFailure(5, 'an input path does not match the coin it spends');
    const result = checkTransaction(txFromHex(build.tx), build.sourceOutputs.map(outputFromWire), browserExpectation(build, wallet, intent));
    if (!result.ok) throw new CheckFailure(result.rule, result.reason);
    o.onStep?.('signing');
    const signed = await session.sign({ tx: build.tx, sourceOutputs: build.sourceOutputs, inputPaths: build.inputPaths, userPrompt: intent.userPrompt });
    o.onStep?.('sending');
    try {
      const sent = await api.post<{ txid: string }>('/api/broadcast', { crossingId, tx: signed });
      return { crossingId, txid: sent.txid, feeSats: BigInt(build.feeSats) };
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'stale_inputs') continue;
      throw e;
    }
  }
}
