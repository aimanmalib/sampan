// "You keep" for Send out and Bring in (ADR 0074, features.keepCompare): the networks the chosen stablecoin crosses
// on in this direction, each quoted through the same endpoint and costed with the same card (web/src/cost/inputs.ts)
// as the panel itself. A network only 1Click carries is quoted by 1Click. Nothing shows until the panel could ask
// for its own quote (amount and address filled), so the first screen does not change.
import { quoteIn, type WireInQuote } from '../../../core/client/in';
import { quoteOut, type WireOutQuote } from '../../../core/client/out';
import { formatUnits } from '../../../core/wallet';
import type { CostCard } from '../../../core/cost';
import type { NetworkRow } from '../../../core/cross-choices';
import { keepList, keepRows, type KeepQuote } from '../../../core/keep';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import { inCard, outCard } from '../cost/inputs';
import { KeepList } from './KeepList';
import { useKeepQuotes, type QuoteState } from './useKeepQuotes';

const BCH = 'BCH';
const BCH_DECIMALS = 8;
const route = (n: NetworkRow) => (n.thor ? {} : { route: 'near-intents' as const });
const routeId = (n: NetworkRow): string => (n.thor ? 'thorchain' : 'near-intents');
/** A USD stablecoin amount from the card's micro-dollars, two decimals rounded to the nearest. */
const usd2 = (micro: bigint): string => formatUnits((micro + 5_000n) / 10_000n, 2, 2);

interface Common {
  config: LoadedConfig;
  /** Every network the panel lists for its direction (open or paused). */
  choices: readonly NetworkRow[];
  picked: NetworkRow;
  onPick: (asset: string) => void;
  disabled: boolean;
}

/** The listed rows of the picked stablecoin, or null when there is nothing to compare. */
function rowsFor(config: LoadedConfig, choices: readonly NetworkRow[], picked: NetworkRow): NetworkRow[] | null {
  if (!config.features.keepCompare) return null;
  const same = keepList(
    choices.filter((c) => c.symbol === picked.symbol),
    config.keepCompare.maxNetworks,
    picked.asset,
  );
  return same.length >= 2 ? same : null;
}

function toKeep<Q>(s: QuoteState<Q> | undefined, cardOf: (q: Q) => { card: CostCard; receive: string } | null): KeepQuote {
  if (!s || s.status === 'loading') return { status: 'pending' };
  if (s.status === 'error') return s;
  const c = cardOf(s.quote);
  return c ? { status: 'ok', ...c } : { status: 'error', code: 'no_card' };
}

export function OutKeep(p: Common & { source: string; amount: bigint | undefined; destination: string }) {
  const { config, choices, picked, source, amount, destination } = p;
  const rows = rowsFor(config, choices, picked);
  const open = rows?.filter((r) => r.open) ?? [];
  const ready = rows !== null && amount !== undefined && amount > 0n && /^0x[0-9a-fA-F]{40}$/.test(destination);
  const key = ready ? `out:${source}:${amount}:${destination.toLowerCase()}:${open.map((r) => r.asset).join(',')}` : null;
  const ask = (asset: string): Promise<WireOutQuote> => {
    const n = open.find((r) => r.asset === asset)!;
    return quoteOut(api, { source, amount: amount!, symbol: n.symbol, chain: n.chain.key, destination, ...route(n) });
  };
  const states = useKeepQuotes(key, open.map((r) => r.asset), ask, config.keepCompare.debounceMs);
  if (!rows || key === null) return null;
  const inputs = rows.map((n) => ({
    asset: n.asset,
    open: n.open,
    quote: toKeep(states[n.asset], (q: WireOutQuote) => {
      const card = outCard(config, q, source, amount!, n.chain.key, routeId(n));
      return card ? { card, receive: usd2(card.receiveUsd) } : null;
    }),
  }));
  return <KeepList config={config} networks={rows} rows={keepRows(inputs)} picked={picked.asset} onPick={p.onPick} disabled={p.disabled} receiveSymbol={picked.symbol} gasExtra={false} />;
}

export function InKeep(p: Common & { amount: bigint | undefined; receive: string; address: string; addressOk: boolean }) {
  const { config, choices, picked, amount, receive, address, addressOk } = p;
  const rows = rowsFor(config, choices, picked);
  const open = rows?.filter((r) => r.open) ?? [];
  const ready = rows !== null && amount !== undefined && amount > 0n && addressOk;
  const key = ready ? `in:${receive}:${amount}:${address}:${open.map((r) => r.asset).join(',')}` : null;
  const ask = (asset: string): Promise<WireInQuote> => {
    const n = open.find((r) => r.asset === asset)!;
    return quoteIn(api, { symbol: n.symbol, chain: n.chain.key, amount: amount!, receive, address, ...route(n) });
  };
  const states = useKeepQuotes(key, open.map((r) => r.asset), ask, config.keepCompare.debounceMs);
  if (!rows || key === null) return null;
  const token = receive !== BCH;
  const inputs = rows.map((n) => ({
    asset: n.asset,
    open: n.open,
    // Gas differs by chain and is known only once a wallet on that chain is connected: every row leaves it out alike.
    quote: toKeep(states[n.asset], (q: WireInQuote) => {
      const card = inCard(config, q, n.chain, token, undefined, routeId(n));
      return card ? { card, receive: token ? usd2(card.receiveUsd) : formatUnits(BigInt(q.expectedSats), BCH_DECIMALS) } : null;
    }),
  }));
  return <KeepList config={config} networks={rows} rows={keepRows(inputs)} picked={picked.asset} onPick={p.onPick} disabled={p.disabled} receiveSymbol={receive} gasExtra />;
}
