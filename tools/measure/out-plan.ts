// Pure parts of tools/measure/out-run.ts: the intent the page would build from a Send out quote, the budget gate
// and the label of the Runs row. Kept apart so they are tested without the network.
import { formatUnits } from '../../core/wallet.js';
import type { OutIntent, WireOutQuote } from '../../core/client/out.js';
import type { OneClickAsset } from '../../core/oneclick-config.js';
import type { SwapIntent } from '../../core/client/swap.js';

export interface OutPick {
  source: string;
  amount: bigint;
  /** Decimals of the source (8 for BCH). */
  decimals: number;
  asset: string;
  chain: string;
  symbol: string;
  destination: string;
  category: string;
  feeCapSats: bigint;
  business: SwapIntent['business'];
  /** 'near-intents' = the 1Click route; absent = the active route. */
  route?: 'near-intents';
}

/** Same fields OutPanel passes to runOut, taken from the quote the run is about to sign. */
export function outIntent(p: OutPick, q: WireOutQuote): OutIntent {
  if (q.source !== p.source || BigInt(q.amount) !== p.amount) throw new Error('the quote is for another amount or source');
  if (q.destination.toLowerCase() !== p.destination.toLowerCase()) throw new Error('the quote names another destination');
  if (p.source !== 'BCH' && !q.swap) throw new Error('a stablecoin source needs the step 1 swap in the quote');
  if ((p.route ?? 'thorchain') !== (q.route === 'near-intents' ? 'near-intents' : 'thorchain')) throw new Error('the quote is for another route');
  const pay = `${formatUnits(p.amount, p.decimals)} ${p.source}`;
  return {
    source: p.source,
    amount: p.amount,
    symbol: p.symbol,
    chain: p.chain,
    asset: p.asset,
    destination: p.destination,
    minOut: BigInt(q.minOut),
    category: p.category,
    ...(q.swap ? { swapMinReceive: BigInt(q.swap.minReceive) } : {}),
    feeCapSats: p.feeCapSats,
    business: p.business,
    ...(p.route ? { route: p.route } : {}),
    prompts: { swap: `Sell ${pay} for BCH (step 1 of Send out)`, deposit: `Send ${pay} out as ${p.symbol} on ${p.chain} (measured run)` },
  };
}

/** Null when the run fits the test budget, else the reason it does not. */
export function overBudget(usd: number, spentToday: number, budget: { maxUsdPerTx: number; maxUsdPerDay: number }): string | null {
  if (!(usd > 0)) return 'the quote has no USD value';
  if (usd > budget.maxUsdPerTx) return `USD ${usd} is above the per-transaction limit ${budget.maxUsdPerTx}`;
  if (spentToday + usd > budget.maxUsdPerDay) return `USD ${usd} would pass the daily limit ${budget.maxUsdPerDay} (spent ${spentToday})`;
  return null;
}

/** "1.80 PUSD to ETH.USDC (at least 1.21 USDC)" for the Runs amount cell. */
export function outLabel(p: Pick<OutPick, 'source' | 'amount' | 'decimals' | 'chain' | 'symbol'>, q: Pick<WireOutQuote, 'minOut' | 'outDecimals'>): string {
  const min = formatUnits(BigInt(q.minOut), q.outDecimals);
  return `${formatUnits(p.amount, p.decimals)} ${p.source} to ${p.chain}.${p.symbol} (at least ${min} ${p.symbol})`;
}

/**
 * The config patch that offers one 1Click asset in one direction on the measuring server, and nothing else of 1Click:
 * the whole assets list with only that entry live that way (the patch replaces lists).
 */
export function oneClickLivePatch(assets: readonly OneClickAsset[], chain: string, symbol: string, dir: 'out' | 'in'): {
  features: { oneClick: true };
  oneClick: { assets: OneClickAsset[] };
} {
  if (!assets.some((a) => a.chain === chain && a.symbol === symbol)) throw new Error(`${symbol} on ${chain} is not in config oneClick.assets`);
  const next = assets.map((a) => ({
    ...a,
    live: { out: false, in: false, [dir]: a.chain === chain && a.symbol === symbol },
  }));
  return { features: { oneClick: true }, oneClick: { assets: next } };
}
