// The parts the two tables of measured runs share: the /how proof table (ProofTable.tsx) and the front page logbook
// (front/Logbook.tsx). Column heads are page text; every transaction id opens in the explorer config names for its
// chain (txLinks.ts), in a new tab, with the whole id as its title.
import type { ProofRun, ProofTxid } from '../../../core/proof';
import { useText } from '../i18n';
import { shortTxid } from './txLinks';

/** The column heads: when, flow, amount, time, result, transaction. */
export function RunsHead() {
  const { t } = useText();
  return (
    <thead>
      <tr>
        <th scope="col">{t('proof.col.when')}</th>
        <th scope="col">{t('proof.col.flow')}</th>
        <th scope="col">{t('proof.col.amount')}</th>
        <th scope="col">{t('proof.col.time')}</th>
        <th scope="col">{t('proof.col.result')}</th>
        <th scope="col">{t('proof.col.txid')}</th>
      </tr>
    </thead>
  );
}

/** One link per transaction id of a run; a run with ids on several chains names the chain before each. */
export function TxAnchors({ run, chainName, href }: { run: ProofRun; chainName: (chain: string) => string; href: (x: ProofTxid) => string }) {
  return (
    <>
      {run.txids.map((x) => (
        <a key={x.id} className="mono" href={href(x)} target="_blank" rel="noreferrer" title={x.id}>
          {run.txids.length > 1 ? `${chainName(x.chain)} ` : ''}
          {shortTxid(x.id)}
        </a>
      ))}
    </>
  );
}
