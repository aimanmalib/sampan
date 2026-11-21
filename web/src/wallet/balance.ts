// What the header balance shows (features.headerBalance, K5P6): BCH rounded down to wallet.balanceBchDecimals, then
// each offered stablecoin with its own decimals. Pure, so the rounding is tested without a page.
import { formatUnits } from '../../../core/wallet.js';
import type { TokenConfig } from '../../../core/config.js';

export interface BalanceLine {
  amount: string;
  unit: string;
}

const BCH_DECIMALS = 8;

/** Rounds down, so the header never shows more than the wallet holds. */
export function balanceLines(
  view: { sats: bigint; tokens: Record<string, bigint> },
  tokens: Pick<TokenConfig, 'symbol' | 'category' | 'decimals'>[],
  bchDecimals: number,
): BalanceLine[] {
  const step = 10n ** BigInt(BCH_DECIMALS - Math.min(Math.max(bchDecimals, 0), BCH_DECIMALS));
  const bch = { amount: formatUnits((view.sats / step) * step, BCH_DECIMALS), unit: 'BCH' };
  const coins = tokens.map((t) => ({
    amount: formatUnits(view.tokens[t.category.toLowerCase()] ?? 0n, t.decimals, t.decimals),
    unit: t.symbol,
  }));
  return [bch, ...coins];
}
