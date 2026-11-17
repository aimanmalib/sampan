// The cost card inputs for the page: the shared mapping (core/client/cost.ts) plus the measured runs of MEASURED.md
// as the page was built (virtual:sampan-proof) for the "about A to B min" range.
import proof from 'virtual:sampan-proof';
import { inCard as inCardOf, outCard as outCardOf } from '../../../core/client/cost';
import type { WireInQuote } from '../../../core/client/in';
import type { WireOutQuote } from '../../../core/client/out';
import type { CostCard, Gas } from '../../../core/cost';
import type { EvmChain } from '../../../core/route-assets';
import type { LoadedConfig } from '../config';

/** Seconds of the measured ok runs of this direction that reached this chain. */
export const measuredSeconds = (flow: 'out' | 'in', chain: string): number[] =>
  proof.runs
    .filter((r) => r.flow === flow && r.ok && r.seconds !== null && r.txids.some((t) => t.chain === chain.toLowerCase()))
    .map((r) => r.seconds!);

export const outCard = (config: LoadedConfig, q: WireOutQuote, source: string, amount: bigint, chain: string): CostCard | null =>
  outCardOf(config, q, source, amount, measuredSeconds('out', chain));

export const inCard = (config: LoadedConfig, q: WireInQuote, chain: EvmChain, receiveToken: boolean, gas: Gas | undefined): CostCard | null =>
  inCardOf(config, q, chain, receiveToken, gas, measuredSeconds('in', chain.key));
