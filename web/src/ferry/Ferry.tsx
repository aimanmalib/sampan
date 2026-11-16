// The ferry on a status page: a boat between two banks whose place is the step read from the crossing answer
// (ferryStep). Decorative (aria-hidden): the timeline beside it carries the meaning in words. With `motion` the
// water and the pole sway while a step is under way; they stop once the boat has arrived, turned back or failed.
import { useText } from '../i18n';
import type { FerryKind, FerryStep } from './step';
import './ferry.css';

export interface FerryBanks {
  from: string;
  to: string;
}

/** Bank labels for a kind; `chain` is the other chain's name for crossings out and in, `symbol` the token. */
export function useBanks(kind: FerryKind, vars: { chain?: string | undefined; symbol?: string }): FerryBanks {
  const { t } = useText();
  const other = vars.chain || t('ferry.bank.other');
  const bch = t('ferry.bank.bch');
  const pick: Record<FerryKind, [string, string]> = {
    land: [bch, t('ferry.bank.owner', { symbol: vars.symbol ?? '' })],
    out: [bch, other],
    in: [other, bch],
    swap: [t('ferry.bank.wallet'), t('ferry.bank.network')],
  };
  const [from, to] = pick[kind];
  return { from, to };
}

export function Ferry({ kind, at, banks, motion }: { kind: FerryKind; at: FerryStep; banks: FerryBanks; motion: boolean }) {
  return (
    <div
      className="ferry"
      aria-hidden="true"
      data-kind={kind}
      data-step={at.step}
      data-of={at.of}
      data-state={at.state}
      data-paid={at.paid ? 'true' : 'false'}
      data-motion={motion ? 'on' : 'off'}
    >
      <p className="ferry__banks">
        <span>{banks.from}</span>
        <span>{banks.to}</span>
      </p>
      <div className="ferry__water">
        <svg className="ferry__river" viewBox="0 0 300 40" preserveAspectRatio="none">
          <path d="M0 30 Q 37 24 75 30 T 150 30 T 225 30 T 300 30" />
          <path className="ferry__wave" d="M-40 36 Q -20 33 0 36 T 40 36 T 80 36 T 120 36 T 160 36 T 200 36 T 240 36 T 280 36 T 320 36 T 360 36" />
        </svg>
        <div className="ferry__lane">
          <svg className="ferry__boat" viewBox="0 0 48 28">
            <g className="ferry__bob">
              <path className="ferry__pole" d="M40 2 L32 22" />
              <path className="ferry__hull" d="M2 16 h44 l-7 9 h-30 z" />
              <path className="ferry__roof" d="M14 16 q10 -12 20 0" />
              <circle className="ferry__coin" cx="24" cy="12" r="3.5" />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
