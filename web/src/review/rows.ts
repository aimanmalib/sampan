// The lines of the review before signing (features.reviewModal, K5P8): what is paid and received, the share kept, the
// cost, the route, the time and the address, built from the same quote and cost card the panel shows. Pure: no React.
import { cardText, type CostCard } from '../../../core/cost.js';

export type ReviewRowKey = 'pay' | 'receive' | 'keep' | 'cost' | 'route' | 'time' | 'to';
export interface ReviewRow {
  key: ReviewRowKey;
  value: string;
}
/** The text keys these lines use (a subset of lang/en.json, so the panels' `t` fits; tests can run without the page). */
type RowTextKey = 'review.receiveValue' | 'review.thenToken' | 'review.swapCost' | 'review.routeSwap' | 'review.toWallet' | 'cost.time' | 'cost.timeRange';
type T = (key: RowTextKey, vars?: Record<string, string>) => string;

/** One string per set of numbers: a different fingerprint while the review is open means the price moved. */
export const fingerprint = (rows: readonly ReviewRow[]): string => rows.map((r) => `${r.key}=${r.value}`).join('\n');

/** A long address cut to its start and end, as the panels show it. */
export const shortAddress = (a: string, head = 6, tail = 4): string => (a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`);

export interface SwapReview {
  pay: string;
  about: string;
  min: string;
  asset: string;
  poolPct: string;
  feeCap: string;
}

/** Swap on BCH: one signature in the connected wallet, so the address line names that wallet. */
export function swapRows(t: T, s: SwapReview): ReviewRow[] {
  return [
    { key: 'pay', value: s.pay },
    { key: 'receive', value: t('review.receiveValue', { about: s.about, min: s.min, asset: s.asset }) },
    { key: 'cost', value: t('review.swapCost', { pct: s.poolPct, fee: s.feeCap }) },
    { key: 'route', value: t('review.routeSwap') },
    { key: 'to', value: t('review.toWallet') },
  ];
}

export interface CrossReview {
  pay: string;
  about: string;
  min: string;
  asset: string;
  /** Bring in as a stablecoin: the BCH lands at a landing address that changes it to this token. */
  thenToken?: string;
  route: string;
  to: string;
  card: CostCard | null;
}

/** Send out and Bring in: the cost card gives the share kept, the total cost and the time. */
export function crossRows(t: T, c: CrossReview): ReviewRow[] {
  const receive = t('review.receiveValue', { about: c.about, min: c.min, asset: c.asset });
  const rows: ReviewRow[] = [
    { key: 'pay', value: c.pay },
    { key: 'receive', value: c.thenToken ? `${receive} ${t('review.thenToken', { token: c.thenToken })}` : receive },
  ];
  if (c.card) {
    const m = c.card.minutes;
    rows.push({ key: 'keep', value: `${c.card.keepPct.toFixed(1)}%` });
    rows.push({ key: 'cost', value: cardText(c.card).total });
    rows.push({ key: 'route', value: c.route });
    rows.push({ key: 'time', value: m.to === undefined ? t('cost.time', { from: String(m.from) }) : t('cost.timeRange', { from: String(m.from), to: String(m.to) }) });
  } else {
    rows.push({ key: 'route', value: c.route });
  }
  rows.push({ key: 'to', value: c.to });
  return rows;
}
