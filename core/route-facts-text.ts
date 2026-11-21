// The words for docs/route-facts.json (K6P5), shared by the hero card line, the /how table and the README blocks
// (scripts/route-facts-table.ts), so all three say the same thing from the same file. Every word comes from lang/*.json
// through `t`; this module only picks keys and formats numbers. A route with no measured time or no quote leaves that
// part out instead of guessing. Pure.
import { FEE_AMOUNTS, type Fee, type FeeAmount, type RouteFact, type RouteFacts } from './route-facts.js';

export type Text = (key: string, vars?: Record<string, string>) => string;
/** Name of a chain key from config (evm.chains[].name). */
export type ChainName = (key: string) => string;

/** The amount the hero line quotes the fee at. */
export const LINE_AMOUNT: FeeAmount = '20';

/** Seconds as the page says them: whole seconds under two minutes, whole minutes from there. */
export function duration(seconds: number, t: Text): string {
  if (seconds < 120) return t('facts.seconds', { n: String(Math.max(1, Math.round(seconds))) });
  return t('facts.minutes', { n: String(Math.round(seconds / 60)) });
}

const money = (usd: number): string => `$${usd.toFixed(2)}`;
/** A percentage with two decimals under 1 %, one decimal from there. */
const percent = (pct: number): string => (pct < 1 ? pct.toFixed(2) : pct.toFixed(1));

/** "fee $0.35 at $20 (1.8 %)", with "plus network fee" when the person's own network fee is not in it; null = no quote. */
export function feeText(fee: Fee, amount: FeeAmount, t: Text): string | null {
  if (fee.usd === null) return null;
  const text = t('facts.fee', { usd: money(fee.usd), at: `$${amount}`, pct: percent(fee.pct) });
  return fee.network === 'excluded' ? `${text} ${t('facts.plusNetwork')}` : text;
}

/** "1 signature", "2 signatures", or for a landing "one payment from any BCH wallet". */
export function signaturesText(f: RouteFact, t: Text): string {
  if (f.signatures === 0 && f.payments > 0) return t('facts.payment');
  return f.signatures === 1 ? t('facts.sig.one') : t('facts.sig.many', { n: String(f.signatures) });
}

/** The route's name: the tab (or landing), and for a crossing the chain and the route that carries it. */
export function routeName(f: RouteFact, t: Text, chainName: ChainName): string {
  const flow = t(f.label);
  if (!f.chain || !f.route) return flow;
  return t('facts.route', { flow, chain: chainName(f.chain), route: t(`route.${f.route}`) });
}

/** The hero line parts: about the time with its runs, the signatures, the fee at USD 20 (parts with no data are left out). */
export function lineParts(f: RouteFact, t: Text): string[] {
  const parts: string[] = [];
  const time = timePart(f, t);
  if (time) parts.push(time);
  parts.push(signaturesText(f, t));
  const fee = feeText(f.fees[LINE_AMOUNT], LINE_AMOUNT, t);
  if (fee) parts.push(fee);
  return parts;
}

/** The time part of a line: "about 8 min, 3 runs", so the runs it was measured over sit next to the time and never after
 *  a quoted fee. */
function timePart(f: RouteFact, t: Text): string | null {
  if (!f.time) return null;
  const time = duration(f.time.median_s, t);
  return f.time.n === 1 ? t('facts.runsOne', { time }) : t('facts.runs', { time, n: String(f.time.n) });
}

/** The short form for the swap card's footer row, which has no room for a line of its own (first screen): the time,
 *  the signatures and the fee at USD 20 without its percentage. */
export function shortParts(f: RouteFact, t: Text): string[] {
  const parts: string[] = [];
  if (f.time) parts.push(t('facts.time', { time: duration(f.time.median_s, t) }));
  parts.push(signaturesText(f, t));
  const fee = f.fees[LINE_AMOUNT];
  if (fee.usd !== null) parts.push(t('facts.feeShort', { usd: money(fee.usd), at: `$${LINE_AMOUNT}` }));
  return parts;
}

/** The short form's visible label: which part was measured and which was quoted ("time measured, fee quoted"). */
export function shortLabel(f: RouteFact, t: Text): string {
  const quoted = f.fees[LINE_AMOUNT].usd !== null;
  if (f.time && quoted) return t('facts.shortBoth');
  if (f.time) return t('facts.measuredShort');
  return quoted ? t('facts.quotedShort') : '';
}

/** The label after the full line, right after the fee: the UTC time the fee was quoted ("quoted 2026-11-20 23:17 UTC"),
 *  or "measured" when there is no quote but a measured time. Empty when there is neither. */
export function lineLabel(f: RouteFact, t: Text): string {
  const fee = f.fees[LINE_AMOUNT];
  if (fee.usd !== null) return t('facts.quotedAt', { at: utc(fee.quoted_at) });
  return f.time ? t('facts.measuredShort') : '';
}

/** The whole label for a screen reader: measured over n runs (when timed), and the UTC time the fee was quoted. */
export function fullLabel(f: RouteFact, t: Text): string {
  const fee = f.fees[LINE_AMOUNT];
  const quoted = fee.usd === null ? null : t('facts.quoted', { at: utc(fee.quoted_at) });
  const measured = !f.time ? null : f.time.n === 1 ? t('facts.measuredOne') : t('facts.measured', { n: String(f.time.n) });
  return [measured, quoted].filter((x): x is string => x !== null).join(' · ');
}

/** The table's time cell: "about 8 min, 3 runs (6 to 18 min)", or "not timed yet". */
export function timeCell(f: RouteFact, t: Text): string {
  const time = timePart(f, t);
  if (!f.time || !time) return t('facts.notTimed');
  const range = f.time.n > 1 ? ` ${t('facts.range', { min: duration(f.time.min_s, t), max: duration(f.time.max_s, t) })}` : '';
  return `${time}${range}`;
}

/** The table's fee cell at one amount: "$0.35 (1.8 %)", "plus network fee" when left out, or "no quote". */
export function feeCell(fee: Fee, t: Text): string {
  if (fee.usd === null) return t('facts.noQuote');
  // A no-break space, so a narrow cell does not wrap the % sign onto a line of its own.
  const text = `${money(fee.usd)} (${percent(fee.pct)}\u00a0%)`;
  return fee.network === 'excluded' ? `${text} ${t('facts.plusNetwork')}` : text;
}

/** "2026-11-20 23:17 UTC". */
export function utc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** The earliest fee quote time in the file (the table's source note names one time). */
export function quotedAt(facts: RouteFacts): string | null {
  const times = facts.routes.flatMap((r) => FEE_AMOUNTS.map((a) => r.fees[a])).flatMap((f) => (f.usd === null ? [] : [f.quoted_at]));
  return times.length ? times.sort()[0]! : null;
}

/** The fact for the route a panel has chosen, by id (`swap`, `land`, `<out|in>:<route>:<chain>`). */
export const factFor = (facts: RouteFacts, id: string): RouteFact | undefined => facts.routes.find((r) => r.id === id);
