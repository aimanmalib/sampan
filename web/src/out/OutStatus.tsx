// Status of a crossing out: deposit sent on Bitcoin Cash, seen by the route, delivered (or refunded) on the
// other chain. The page asks again every `landing.pagePollSeconds` until the answer is final.
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';

export interface OutView {
  status: string;
  route: string | null;
  asset: string;
  txid: string | null;
  out: { stage: 'unseen' | 'pending' | 'done' | 'refunded' | 'unknown'; outTxid: string | null; outChain: string | null } | null;
}

const STEPS = ['sent', 'seen', 'delivered'] as const;

/** How many steps are done for this answer. */
function reached(c: OutView): number {
  if (!c.txid) return 0;
  const stage = c.out?.stage;
  if (stage === 'done' || stage === 'refunded') return 3;
  if (stage === 'pending') return 2;
  return 1;
}

export const outIsFinal = (c: OutView): boolean => c.status === 'completed' || c.status === 'refunded' || c.status === 'failed';

export function OutStatus({ c, config }: { c: OutView; config: LoadedConfig | null }) {
  const { t } = useText();
  const vars = { route: t(`route.${c.route ?? 'thorchain'}` as TextKey), symbol: c.asset };
  const n = reached(c);
  const stage = c.status === 'completed' ? 'completed' : c.status === 'refunded' ? 'refunded' : c.txid ? (c.out?.stage ?? 'unknown') : 'built';
  const chain = config?.evm.chains.find((ch) => ch.key === c.out?.outChain);
  return (
    <>
      <ol className="timeline">
        {STEPS.map((step, i) => (
          <li key={step} className={`timeline__step${i < n ? ' timeline__step--done' : ''}`}>
            <span className="timeline__mark" aria-hidden="true" />
            <span>
              {t(`crossing.out.step.${step}` as TextKey, vars)}
              <span className="visually-hidden">{i < n ? t('crossing.done') : t('crossing.pending')}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="crossing__status">{t(`crossing.out.status.${stage === 'done' ? 'completed' : stage}` as TextKey, vars)}</p>
      {c.txid && config ? (
        <p className="crossing__tx">
          <span>{t('crossing.txid')} </span>
          <a className="mono" href={config.connect.explorerTxUrl.replace('{txid}', c.txid)} target="_blank" rel="noreferrer">
            {`${c.txid.slice(0, 10)}…${c.txid.slice(-8)}`}
          </a>
        </p>
      ) : null}
      {c.out?.outTxid && chain ? (
        <p className="crossing__tx timeline__out">
          <span>{t('crossing.out.outTx', { chain: chain.name })} </span>
          <a className="mono" href={`${chain.explorer}/tx/0x${c.out.outTxid.toLowerCase()}`} target="_blank" rel="noreferrer">
            {`0x${c.out.outTxid.slice(0, 8).toLowerCase()}…${c.out.outTxid.slice(-8).toLowerCase()}`}
          </a>
        </p>
      ) : null}
    </>
  );
}
