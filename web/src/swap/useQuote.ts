// Live swap quote while the user types, asked again on each refresh tick (quote/useLiveQuote.ts).
import { quoteSwap, type WireQuote } from '../../../core/client/swap';
import type { TradeSide } from '../../../core/pools/trade';
import { api } from '../api';
import { useLiveQuote, type LiveQuote } from '../quote/useLiveQuote';

export type QuoteState = LiveQuote<WireQuote>;

export function useQuote(token: string, side: TradeSide, amount: bigint | undefined, pauseMs: number, tick = 0): QuoteState {
  const key = amount !== undefined && amount > 0n ? `${token}:${side}:${amount}` : null;
  return useLiveQuote(key, () => quoteSwap(api, { token, side, amount: amount ?? 0n }), pauseMs, tick);
}
