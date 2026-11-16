// "Send out" as the page runs it. From the stablecoin: step 1 is a swap to BCH (the swap flow, its own check),
// step 2 deposits that BCH with the route. From BCH: the deposit alone. The deposit is checked here against
// what the page showed (rule 6 shape, memo naming the typed address and at least the shown minimum) before
// the wallet sees it. If the user stops after step 1, the BCH is in their own wallet and step 2 can resume.
import { checkTransaction, type Expectation } from '../check.js';
import { memoMatches, opReturnHex } from '../routes/memo.js';
import { outputFromWire, txFromHex, type WireOutput } from '../wire.js';
import type { Api } from './api.js';
import type { WalletView } from './scan.js';
import type { WalletSession } from './session.js';
import { CheckFailure, runSwap, type SwapIntent, type SwapStep, type WireQuote } from './swap.js';

export interface WireOutQuote {
  source: string;
  amount: string;
  usd: number;
  swap?: WireQuote;
  route: string;
  sats: string;
  vault: string;
  memo: string;
  asset: string;
  destination: string;
  expectedOut: string;
  minOut: string;
  outDecimals: number;
  fees: { total: string; totalBps: number };
  expiry: number;
  seconds: number;
}

export interface OutIntent {
  /** 'BCH' or the token symbol. */
  source: string;
  /** Base units of the source. */
  amount: bigint;
  symbol: string;
  chain: string;
  /** Route form of the asset, built in the page from config (e.g. BASE.USDC-0X8335…). */
  asset: string;
  destination: string;
  /** Minimum output the page showed, in the route's units. */
  minOut: bigint;
  /** Token category of the source (or of the default token for a BCH source). */
  category: string;
  /** Step 1 minimum BCH shown (token source only). */
  swapMinReceive?: bigint;
  feeCapSats: bigint;
  business: SwapIntent['business'];
  prompts: { swap: string; deposit: string };
}

export interface OutProgress {
  step: 1 | 2;
  phase: SwapStep;
}

interface BuildReply {
  crossingId: string;
  tx: string;
  sourceOutputs: WireOutput[];
  inputPaths: Array<{ inputIndex: number; path: string }>;
  feeSats: string;
  quote: WireOutQuote;
  deposit: { lockingBytecode: string; sats: string; opReturn: string };
}

export const quoteOut = async (api: Api, b: { source: string; amount: bigint; symbol: string; chain: string; destination: string }): Promise<WireOutQuote> =>
  (await api.post<{ quote: WireOutQuote }>('/api/out/quote', { ...b, amount: b.amount.toString() })).quote;

/** The page's own expectation for the deposit; only the vault, amount and input paths come from the server. */
export function depositExpectation(build: BuildReply, wallet: WalletView, intent: OutIntent): Expectation {
  const memo = memoMatches(build.quote.memo, { asset: intent.asset, destination: intent.destination, minOut: intent.minOut });
  if (memo !== true) throw new CheckFailure(6, memo);
  const opReturn = opReturnHex(build.quote.memo);
  if (opReturn !== build.deposit.opReturn) throw new CheckFailure(6, 'the memo output differs from the memo');
  const sats = BigInt(build.deposit.sats);
  if (intent.source === 'BCH' && sats !== intent.amount) throw new CheckFailure(3, 'the deposit is not the amount shown');
  return {
    userLockingBytecodes: wallet.derived.map((a) => a.lockingHex),
    inputPaths: build.inputPaths,
    poolOwnerPkhs: [],
    deposits: [{ lockingBytecode: build.deposit.lockingBytecode, sats }],
    opReturn,
    thorDeposit: true,
    spend: { sats, tokens: {} },
    feeCapSats: intent.feeCapSats,
    receive: { category: intent.category.toLowerCase(), min: 0n },
  };
}

function pathsMatchCoins(build: BuildReply, wallet: WalletView): boolean {
  return build.inputPaths.every((p) => {
    const src = build.sourceOutputs[p.inputIndex];
    const addr = wallet.derived.find((a) => `${a.path}/${a.index}` === p.path);
    return !!src && !!addr && src.lockingBytecode === addr.lockingHex;
  });
}

export class StoppedAfterStep1 extends Error {
  constructor(
    readonly swapTxid: string,
    readonly reason: unknown,
  ) {
    super('step 2 did not finish; the BCH from step 1 is in your wallet');
    this.name = 'StoppedAfterStep1';
  }
}

export async function runOut(o: {
  api: Api;
  session: WalletSession;
  wallet: WalletView;
  intent: OutIntent;
  /** Resume at step 2 with the BCH that this step 1 transaction paid. */
  fromTxid?: string;
  onStep?: (p: OutProgress) => void;
}): Promise<{ crossingId: string; txid: string; swapTxid?: string }> {
  const { api, session, wallet, intent } = o;
  let fromTxid = o.fromTxid;
  if (intent.source !== 'BCH' && !fromTxid) {
    if (intent.swapMinReceive === undefined) throw new Error('step 1 needs the minimum shown');
    const swap = await runSwap({
      api,
      session,
      wallet,
      intent: {
        token: intent.source,
        side: 'sell',
        amount: intent.amount,
        minReceive: intent.swapMinReceive,
        category: intent.category,
        feeCapSats: intent.feeCapSats,
        userPrompt: intent.prompts.swap,
        business: intent.business,
      },
      onStep: (phase) => o.onStep?.({ step: 1, phase }),
    });
    fromTxid = swap.txid;
  }
  const step2 = async (): Promise<{ crossingId: string; txid: string }> => {
    o.onStep?.({ step: 2, phase: 'building' });
    const addresses = [...new Map([...wallet.coins.map((c) => c.address), wallet.receive, wallet.change].map((a) => [a.address, { address: a.address, path: `${a.path}/${a.index}` }])).values()];
    const build = await api.post<BuildReply>('/api/out/build', {
      source: intent.source,
      amount: intent.amount.toString(),
      symbol: intent.symbol,
      chain: intent.chain,
      destination: intent.destination,
      minOut: intent.minOut.toString(),
      addresses,
      ...(fromTxid ? { fromTxid } : {}),
    });
    o.onStep?.({ step: 2, phase: 'checking' });
    if (!pathsMatchCoins(build, wallet)) throw new CheckFailure(5, 'an input path does not match the coin it spends');
    const result = checkTransaction(txFromHex(build.tx), build.sourceOutputs.map(outputFromWire), depositExpectation(build, wallet, intent));
    if (!result.ok) throw new CheckFailure(result.rule, result.reason);
    o.onStep?.({ step: 2, phase: 'signing' });
    const signed = await session.sign({ tx: build.tx, sourceOutputs: build.sourceOutputs, inputPaths: build.inputPaths, userPrompt: intent.prompts.deposit });
    o.onStep?.({ step: 2, phase: 'sending' });
    const sent = await api.post<{ txid: string }>('/api/broadcast', { crossingId: build.crossingId, tx: signed });
    return { crossingId: build.crossingId, txid: sent.txid };
  };
  try {
    const res = await step2();
    return { ...res, ...(fromTxid ? { swapTxid: fromTxid } : {}) };
  } catch (e) {
    if (fromTxid) throw new StoppedAfterStep1(fromTxid, e);
    throw e;
  }
}
