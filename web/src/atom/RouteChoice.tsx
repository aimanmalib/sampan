// "Choose a route" inside Send out and Bring in: one row per route for the same amount, with what each delivers,
// the network fees as each reports them, the measured time and how the funds are held. The card appears only when
// the atomic swap route has a row (flag on, flow offered in config, service checked); otherwise the panel is as before.
// THORChain stays selected until the user picks the other row; an unavailable row says why and cannot be picked.
import { useId, useState, type ReactNode } from 'react';
import proof from 'virtual:sampan-proof';
import { atomFlowFor, compareRoutes, type CompareFlow, type RouteRow, type ThorSide } from '../../../core/routes/compare';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import { useAtomQuote } from './useAtomQuote';
import './atom.css';

export type RouteId = RouteRow['route'];
type T = ReturnType<typeof useText>['t'];

const REASONS = ['inventory', 'below-min', 'above-max', 'daily-limit', 'stale', 'wrong-flow', 'unavailable'];
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
  return estimate === undefined ? measured : `${measured} ${t('compare.time.estimate', { minutes: minutes(estimate) })}`;
}

function trustText(t: T, row: RouteRow): string {
  const tr = row.trust;
  if (tr.kind === 'vaults') return t('compare.trust.vaults');
  const base = t('compare.trust.locks', { after: waitText(t, tr.userLockReturnsAfter), bch: String(tr.confirmations.bch), base: String(tr.confirmations.base) });
  return tr.anyoneMaySettle ? `${base} ${t('compare.trust.settle')}` : base;
}

function reasonText(t: T, code: string): string {
  return REASONS.includes(code) ? t(`compare.reason.${code}` as TextKey) : t('compare.reason.other', { code });
}

function Row({ row, name, chosen, onPick }: { row: RouteRow; name: string; chosen: boolean; onPick: () => void }) {
  const { t } = useText();
  const off = row.route === 'atom' && !row.available;
  const fees = feesText(t, row);
  return (
    <li className={`routes__row${off ? ' routes__row--off' : ''}`} data-route={row.route}>
      <label className="routes__pick">
        <input type="radio" name={name} value={row.route} checked={chosen} disabled={off} onChange={onPick} />
        <span className="routes__name">{t(`route.${row.route}` as TextKey)}</span>
        {row.receivesMore ? <span className="routes__more">{t('compare.more')}</span> : null}
      </label>
      {off ? (
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

/**
 * The route card for one request, and the route the action button should run. `flow` null = no amount yet;
 * `thor` = THORChain's side of the same request, or a short code while its quote is pending or refused.
 */
export function useRouteChoice(config: LoadedConfig, flow: CompareFlow | null, thor: ThorSide | { error: string }): { card: ReactNode; route: RouteId } {
  const { t } = useText();
  const name = useId();
  const [picked, setPicked] = useState<RouteId>('thorchain');
  const token = config.tokens[config.defaultToken]!.symbol;
  const atomFlow = flow ? atomFlowFor(flow, token) : null;
  const atom = useAtomQuote(config, atomFlow, flow?.amount ?? null);
  if (!flow || !atom) return { card: null, route: 'thorchain' };
  const { rows } = compareRoutes({ flow, thor, atom, proof, config: { token, atomFlows: config.atom.flows } });
  if (rows.length < 2) return { card: null, route: 'thorchain' };
  const route = picked === 'atom' && rows.some((r) => r.route === 'atom' && r.available) ? 'atom' : 'thorchain';
  const card = (
    <fieldset className="routes">
      <legend className="routes__title">{t('compare.title')}</legend>
      <ul className="routes__list">
        {rows.map((row) => (
          <Row key={row.route} row={row} name={name} chosen={route === row.route} onPick={() => setPicked(row.route)} />
        ))}
      </ul>
    </fieldset>
  );
  return { card, route };
}
