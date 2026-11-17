// From the quotes as the server sends them to the cost card (core/cost.ts). Shared by the page and the measuring
// tool, so the card a run records is the card the page showed for the same quote. Pure.
import { inCost, outCost, type CostCard, type Gas, type ThorFees, type Timing } from '../cost.js';
import type { PublicConfig } from '../config.js';
import type { EvmChain } from '../route-assets.js';
import type { WireInQuote } from './in.js';
import type { WireFees, WireOutQuote } from './out.js';
import type { WireQuote } from './swap.js';

type CardConfig = Pick<PublicConfig, 'tokens' | 'defaultToken' | 'connect' | 'landing' | 'limits'>;

const big = (v: string | undefined): bigint => (v && /^[0-9]+$/.test(v) ? BigInt(v) : 0n);

/** Named fees, or null from a server that does not send them (no card then). */
const feesOf = (f: WireFees | undefined): ThorFees | null =>
  f && f.outbound !== undefined && f.liquidity !== undefined
    ? { liquidity: big(f.liquidity), outbound: big(f.outbound), affiliate: big(f.affiliate), slippageBps: f.slippageBps ?? 0 }
    : null;

const step = (q: WireQuote) => ({
  supply: big(q.supply),
  demand: big(q.demand),
  poolFeeSats: big(q.poolFeeSats),
  sampanFeeSats: big(q.sampanFeeSats),
  impactBps: q.impactBps ?? 0,
});

/** The card counts the received asset in 1e8 units, as THORChain reports it; 1Click reports the token's own decimals. */
const to1e8 = (v: bigint, decimals: number): bigint => (decimals >= 8 ? v / 10n ** BigInt(decimals - 8) : v * 10n ** BigInt(8 - decimals));

export function outCard(config: CardConfig, q: WireOutQuote, source: string, amount: bigint, measured: number[]): CostCard | null {
  const named = feesOf(q.fees);
  if (!named) return null;
  const scale = (v: bigint): bigint => to1e8(v, q.outDecimals);
  const fees = { ...named, liquidity: scale(named.liquidity), outbound: scale(named.outbound), affiliate: scale(named.affiliate) };
  const token = config.tokens[config.defaultToken]!;
  const timing: Timing = { routeSeconds: q.seconds, sourceBlockSeconds: config.connect.bchBlockSeconds, measured };
  return outCost({
    fromToken: source !== 'BCH' && q.swap !== undefined,
    amount,
    tokenDecimals: token.decimals,
    ...(q.swap ? { swap: { ...step(q.swap), networkSats: big(q.swap.networkSats) } } : {}),
    depositSats: big(q.sats),
    depositNetworkSats: big(q.depositNetworkSats),
    expectedOut: scale(big(q.expectedOut)),
    fees,
    expiry: q.expiry,
    timing,
    warnBps: config.limits.feeWarnBps,
  });
}

export function inCard(config: CardConfig, q: WireInQuote, chain: EvmChain, receiveToken: boolean, gas: Gas | undefined, measured: number[]): CostCard | null {
  const fees = feesOf(q.fees);
  if (!fees) return null;
  const token = config.tokens[config.defaultToken]!;
  const timing: Timing = { routeSeconds: q.seconds, sourceBlockSeconds: chain.gas.blockSeconds, measured };
  return inCost({
    amount: big(q.amount),
    expectedSats: big(q.expectedSats),
    fees,
    ...(receiveToken && q.convert
      ? {
          landing: {
            swap: step(q.convert),
            convertFeeSats: BigInt(config.landing.convertFeeSats),
            tokenDustSats: BigInt(config.connect.tokenDustSats),
            tokenDecimals: token.decimals,
          },
        }
      : {}),
    ...(gas ? { gas } : {}),
    expiry: q.expiry,
    timing,
    warnBps: config.limits.feeWarnBps,
  });
}
