// "Choose a route" inside Send out and Bring in: one row per route for the same amount, with what each delivers,
// the fees as each reports them, the measured time and how the funds are held. The card appears only when a second
// route has a row: the atomic swap route (flag on, flow offered in config, service checked) or 1Click (flag on, asset
// live in that direction); otherwise the panel is as before. THORChain stays selected until the user picks another
// row; an unavailable row says why and cannot be picked.
import { useId, useState, type ReactNode } from 'react';
import proof from 'virtual:sampan-proof';
import { atomFlowFor, compareRoutes, type CompareFlow, type RouteRow, type ThorSide } from '../../../core/routes/compare';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import { outCodeKey } from '../out/errors';
import { useAtomQuote, type AtomReady } from './useAtomQuote';
import './atom.css';

export type RouteId = RouteRow['route'];
type T = ReturnType<typeof useText>['t'];

/** The code a panel gives THORChain's side for a network THORChain halts now (core/cross-choices thor false). */
export const CHAIN_HALTED = 'chain_halted';
export const REASONS = ['inventory', 'below-min', 'above-max', 'daily-limit', 'stale', 'wrong-flow', 'unavailable'];
const SHOWN_DECIMALS = 2;

/** A decimal amount cut (not rounded up) to two decimals, as the panels show route amounts. */
const cut = (amount: string): string => {
  const [whole = '0', frac = ''] = amount.split('.');
  return `${whole}.${frac.padEnd(SHOWN_DECIMALS, '0').slice(0, SHOWN_DECIMALS)}`;
};
const minutes = (seconds: number): string => String(Math.max(1, Math.round(seconds / 60)));

type Wait = Extract<RouteRow['trust'], { kind: 'locks' }>['userLockReturnsAfter'];
function waitText(t: T, w: Wait): string {
  if (w.chain === 'bch') return t('compare.wait.blocks', { n: String(w.blocks) });
  return w.seconds % 3600 === 0 ? t('compare.wait.hours', { n: String(w.seconds / 3600) }) : t('compare.wait.minutes', { n: minutes(w.seconds) });
}

function feesText(t: T, row: RouteRow): string | null {
  const f = row.fees;
  if (f === null) return null;
  if (!Array.isArray(f)) return t('compare.fee.route', { fee: cut(f.total), symbol: row.receiveSymbol, pct: (f.totalBps / 100).toFixed(1) });
  const legs = f.flatMap((leg) => {
    if (leg.chain === 'bch') return [t('compare.fee.sats', { n: String(leg.sats) })];
    return typeof leg.gasUnits === 'number' ? [t('compare.fee.gas', { n: String(leg.gasUnits) })] : [];
  });
  return legs.length ? t('compare.fee.network', { fees: legs.join(' + ') }) : null;
}

function timeText(t: T, row: RouteRow): string {
  const { median, count, estimate } = row.seconds;
  const measured =
    median === null ? t('compare.time.none') : t(count === 1 ? 'compare.time.one' : 'compare.time.many', { minutes: minutes(median), count: String(count) });
  if (estimate === undefined) return measured;
  // THORChain keeps its own sentence; another route's estimate names that route.
  const said =
    row.route === 'thorchain'
      ? t('compare.time.estimate', { minutes: minutes(estimate) })
      : t('compare.time.estimateRoute', { route: t(`route.${row.route}` as TextKey), minutes: minutes(estimate) });
  return `${measured} ${said}`;
}

function trustText(t: T, row: RouteRow): string {
  const tr = row.trust;
  if (tr.kind === 'vaults') return t('compare.trust.vaults');
  if (tr.kind === 'deposit') return t('compare.trust.deposit', { minutes: String(tr.deadlineMinutes) });
  const base = t('compare.trust.locks', { after: waitText(t, tr.userLockReturnsAfter), bch: String(tr.confirmations.bch), base: String(tr.confirmations.base) });
  return tr.anyoneMaySettle ? `${base} ${t('compare.trust.settle')}` : base;
}

export function reasonText(t: T, code: string): string {
  return REASONS.includes(code) ? t(`compare.reason.${code}` as TextKey) : t('compare.reason.other', { code });
}

/** Why the 1Click row cannot be picked: its quote is on the way, was for another amount, or the server's code. */
function oneClickReason(t: T, code: string, vars: Record<string, string>): string {
  if (code === 'stale') return t('compare.reason.stale');
  // 1Click names its own minimum, which config does not hold: no number is said for it.
  if (code === 'below_route_min') return t('compare.reason.routeMin', vars);
  return t(outCodeKey(code), vars);
}

function Row({ row, name, chosen, onPick, vars }: { row: RouteRow; name: string; chosen: boolean; onPick: () => void; vars: Record<string, string> }) {
  const { t } = useText();
  // THORChain's row is off only while it halts this network (KSG6); otherwise it stays picked while its quote loads.
  const off = !row.available && (row.route !== 'thorchain' || row.reason === CHAIN_HALTED);
  const waiting = off && row.reason === 'pending';
  const fees = feesText(t, row);
  return (
    <li className={`routes__row${off ? ' routes__row--off' : ''}`} data-route={row.route}>
      <label className="routes__pick">
        <input type="radio" name={name} value={row.route} checked={chosen} disabled={off} onChange={onPick} />
        <span className="routes__name">{t(`route.${row.route}` as TextKey)}</span>
        {row.receivesMore ? <span className="routes__more">{t('compare.more')}</span> : null}
      </label>
      {waiting ? (
        <p className="routes__receive">{t('compare.receive.pending')}</p>
      ) : off && row.route === 'thorchain' ? (
        <p className="routes__reason">{t('compare.reason.chainPaused', { route: t('route.thorchain') })}</p>
      ) : off && row.route === 'near-intents' ? (
        <p className="routes__reason">{oneClickReason(t, row.reason ?? 'route_unavailable', vars)}</p>
      ) : off ? (
        <p className="routes__reason">{t('compare.unavailable', { reason: reasonText(t, row.reason ?? 'unavailable') })}</p>
      ) : (
        <>
          <p className="routes__receive">
            {row.receive === null ? t('compare.receive.pending') : t('compare.receive', { amount: cut(row.receive), symbol: row.receiveSymbol })}
          </p>
          {fees ? <p className="routes__fact">{fees}</p> : null}
          <p className="routes__fact">{timeText(t, row)}</p>
        </>
      )}
      <details className="routes__how">
        <summary>{t('compare.how')}</summary>
        <p>{trustText(t, row)}</p>
      </details>
    </li>
  );
}

/** 1Click's side of the same request: its quote (or error code), and the words its refusals are said with. */
export interface OneClickSide {
  quote: ThorSide | { error: string } | null;
  vars: Record<string, string>;
}

/**
 * The route card for one request, and the route the action button should run. `flow` null = no amount yet;
 * `thor` = THORChain's side of the same request, or a short code while its quote is pending or refused; `oneClick`
 * = 1Click's side, null when the page did not ask it.
 */
export function useRouteChoice(
  config: LoadedConfig,
  flow: CompareFlow | null,
  thor: ThorSide | { error: string },
  oneClick: OneClickSide | null = null,
): { card: ReactNode; route: RouteId; atom: AtomReady | null } {
  const { t } = useText();
  const name = useId();
  const [picked, setPicked] = useState<RouteId>('thorchain');
  const token = config.tokens[config.defaultToken]!.symbol;
  const atomFlow = flow ? atomFlowFor(flow, token) : null;
  const { quote: atom, ready } = useAtomQuote(config, atomFlow, flow?.amount ?? null);
  if (!flow) return { card: null, route: 'thorchain', atom: null };
  const { rows } = compareRoutes({
    flow,
    thor,
    atom,
    oneClick: oneClick?.quote ?? null,
    proof,
    config: { token, atomFlows: config.atom.flows, oneClick: { enabled: config.features.oneClick, offer: config.oneClick } },
  });
  if (rows.length < 2) return { card: null, route: 'thorchain', atom: null };
  // While THORChain halts this network its row cannot run, so the 1Click row is the one the button runs.
  const thorOff = rows[0]?.route === 'thorchain' && rows[0].reason === CHAIN_HALTED;
  const fallback: RouteId = thorOff && rows.some((r) => r.route === 'near-intents') ? 'near-intents' : 'thorchain';
  const route = picked !== 'thorchain' && rows.some((r) => r.route === picked && r.available) ? picked : fallback;
  const card = (
    <fieldset className="routes">
      <legend className="routes__title">{t('compare.title')}</legend>
      <ul className="routes__list">
        {rows.map((row) => (
          <Row key={row.route} row={row} name={name} chosen={route === row.route} onPick={() => setPicked(row.route)} vars={oneClick?.vars ?? {}} />
        ))}
      </ul>
    </fieldset>
  );
  return { card, route, atom: route === 'atom' ? ready : null };
}
