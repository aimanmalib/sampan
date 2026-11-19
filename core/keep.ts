// "You keep" before signing (ADR 0074): one row per network the chosen stablecoin crosses on in a direction, each with
// what that network's quote leaves the user (amount and percent of the value), its total cost and its time, all from
// the same cost card the panel shows (core/cost.ts). Pure. A paused network stays listed but never wins; a network
// whose quote failed shows no numbers. Behind features.keepCompare; keepCompare holds the limits.
import type { CostCard } from './cost.js';

export interface KeepConfig {
  /** Most open networks quoted at once (each one is a quote request). */
  maxNetworks: number;
  /** Pause after the last keystroke before the networks are quoted. */
  debounceMs: number;
}

export function validateKeep(k: KeepConfig | undefined): string[] {
  const int = (v: unknown, lo: number, hi: number): boolean => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  const errors: string[] = [];
  if (!int(k?.maxNetworks, 2, 8)) errors.push('keepCompare.maxNetworks: an integer from 2 to 8');
  if (!int(k?.debounceMs, 200, 3000)) errors.push('keepCompare.debounceMs: an integer from 200 to 3000');
  return errors;
}

export type KeepQuote =
  | { status: 'pending' }
  | { status: 'error'; code: string }
  | { status: 'ok'; card: CostCard; receive: string };

export interface KeepInput {
  asset: string;
  /** False while every route that carries it reports its chain (or Bitcoin Cash) halted. */
  open: boolean;
  quote: KeepQuote;
}

export interface KeepRow extends KeepInput {
  /** True on the one open row that keeps the most, when at least two open rows are priced and they differ. */
  best: boolean;
}

/**
 * The rows to show, in the order given: every paused row, and open rows up to `max` (the picked one always among
 * them). Paused rows ask for nothing, so they do not count against `max`.
 */
export function keepList<T extends { asset: string; open: boolean }>(rows: readonly T[], max: number, picked: string | undefined): T[] {
  const open = rows.filter((r) => r.open);
  const kept = new Set(open.slice(0, max).map((r) => r.asset));
  if (picked !== undefined && open.some((r) => r.asset === picked) && !kept.has(picked)) {
    kept.delete(open[max - 1]!.asset);
    kept.add(picked);
  }
  return rows.filter((r) => !r.open || kept.has(r.asset));
}

export function keepRows(inputs: readonly KeepInput[]): KeepRow[] {
  const priced = inputs.filter((r): r is KeepInput & { quote: { status: 'ok'; card: CostCard } } => r.open && r.quote.status === 'ok');
  const pcts = priced.map((r) => r.quote.card.keepPct);
  const top = Math.max(...pcts);
  const best = priced.length >= 2 && top > Math.min(...pcts) ? priced.find((r) => r.quote.card.keepPct === top)?.asset : undefined;
  return inputs.map((r) => ({ ...r, best: r.asset === best }));
}

/**
 * Percent of the value kept on a route row (the "Choose a route" card), where no cost card is built: only when both
 * sides are USD stablecoins (counted at USD 1 each, as the cost card does), else null and the row names the amount only.
 */
export function routeKeepPct(pay: { amount: string; symbol: string }, receive: { amount: string; symbol: string }, usd: readonly string[]): number | null {
  if (!usd.includes(pay.symbol) || !usd.includes(receive.symbol)) return null;
  const p = Number(pay.amount);
  const r = Number(receive.amount);
  if (!Number.isFinite(p) || !Number.isFinite(r) || p <= 0) return null;
  return Math.floor((r / p) * 10_000) / 100;
}
