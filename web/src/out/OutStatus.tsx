// Status of a crossing through the route. Out: deposit sent on Bitcoin Cash, seen by the route, delivered (or
// refunded) on the other chain. In: the same three steps from the other chain to Bitcoin Cash. The page asks again every `landing.pagePollSeconds` until the answer is final.
import type { LoadedConfig } from '../config';
import { Ferry, useBanks } from '../ferry/Ferry';
import { ferryStep } from '../ferry/step';
import { useText, type TextKey } from '../i18n';

export interface OutView {
  status: string;
  route: string | null;
  asset: string;
  /** Chain key of the stablecoin side (ETH, BSC, …); null for a crossing that did not record one. */
  chain: string | null;
  txid: string | null;
  out: { stage: 'unseen' | 'pending' | 'done' | 'refunded' | 'unknown'; outTxid: string | null; outChain: string | null } | null;
}

export const outIsFinal = (c: OutView): boolean => c.status === 'completed' || c.status === 'refunded' || c.status === 'failed';

/** `txLinks` false: the receipt below lists the transactions in full instead. */
export function OutStatus({ c, config, direction, txLinks = true }: { c: OutView; config: LoadedConfig | null; direction: 'out' | 'in'; txLinks?: boolean }) {
  const { t } = useText();
  const vars = { route: t(`route.${c.route ?? 'thorchain'}` as TextKey), symbol: c.asset };
  const at = ferryStep(direction, c);
  const n = at.done;
  const stage = c.status === 'completed' ? 'completed' : c.status === 'refunded' ? 'refunded' : c.txid ? (c.out?.stage ?? 'unknown') : 'built';
  // The other chain: the one the route reports paying on (out), else the one the crossing was made for.
  const evmChain = config?.evm.chains.find((ch) => ch.key === ((direction === 'out' ? c.out?.outChain : null) ?? c.chain));
  const bchLink = (txid: string): string => config?.connect.explorerTxUrl.replace('{txid}', txid.toLowerCase()) ?? '#';
  const evmLink = (txid: string): string => `${evmChain?.explorer ?? ''}/tx/0x${txid.toLowerCase()}`;
  // Out: the BCH deposit, then the other chain's payment. In: the other chain's deposit, then the BCH payment.
  const source = c.txid && config && (direction === 'out' || evmChain) ? (direction === 'out' ? bchLink(c.txid) : evmLink(c.txid)) : null;
  const paid = c.out?.outTxid && config && (direction === 'in' || evmChain) ? (direction === 'out' ? evmLink(c.out.outTxid) : bchLink(c.out.outTxid)) : null;
  const banks = useBanks(direction, { chain: evmChain?.name });
  const short = (h: string): string => `${h.slice(0, 10).toLowerCase()}…${h.slice(-8).toLowerCase()}`;
  return (
    <>
      {config?.ui.ferryMotion ? <Ferry kind={direction} at={at} banks={banks} motion /> : null}
      <ol className="timeline">
        {at.steps.map((step, i) => (
          <li key={step} className={`timeline__step${i < n ? ' timeline__step--done' : ''}`}>
            <span className="timeline__mark" aria-hidden="true" />
            <span>
              {t(`crossing.${direction}.step.${step}` as TextKey, vars)}
              <span className="visually-hidden">{i < n ? t('crossing.done') : t('crossing.pending')}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="crossing__status">{t(`crossing.${direction}.status.${stage === 'done' ? 'completed' : stage}` as TextKey, vars)}</p>
      {txLinks && source && c.txid ? (
        <p className="crossing__tx">
          <span>{t('crossing.txid')} </span>
          <a className="mono" href={source} target="_blank" rel="noreferrer">
            {short(c.txid)}
          </a>
        </p>
      ) : null}
      {txLinks && paid && c.out?.outTxid ? (
        <p className="crossing__tx timeline__out">
          <span>{t(`crossing.${direction}.outTx`, { chain: evmChain?.name ?? '' })} </span>
          <a className="mono" href={paid} target="_blank" rel="noreferrer">
            {short(c.out.outTxid)}
          </a>
        </p>
      ) : null}
    </>
  );
}
