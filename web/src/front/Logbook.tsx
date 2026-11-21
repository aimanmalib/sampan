// The logbook under the Measured line: the newest mainnet runs of docs/MEASURED.md as they were when the page was
// built (virtual:sampan-proof), failed runs included, every transaction id opening in the explorer config names. As
// many rows as "Newest runs" on /how (config site.proofRuns), laid out as a table on a wide screen. A run carried by
// the 1Click route is listed only while features.oneClick is on.
import proof from 'virtual:sampan-proof';
import type { ProofRun } from '../../../core/proof';
import type { LoadedConfig } from '../config';
import { RunsHead, TxAnchors } from '../how/RunParts';
import { runText } from '../how/txLinks';
import { useText, type TextKey } from '../i18n';
import './logbook.css';

/** Flows whose name is the 1Click route's: listed only while that route is offered (the front page names no route it
 *  does not offer; /how lists every measured run whatever the flags say). */
const ONE_CLICK_FLOWS: readonly ProofRun['flow'][] = ['oc-out', 'oc-in'];

export function Logbook({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  const runs = proof.runs.filter((r) => config.features.oneClick || !ONE_CLICK_FLOWS.includes(r.flow));
  if (runs.length === 0) return null;
  const { chainName, href, time } = runText(config, t);
  const links = (run: ProofRun) =>
    run.txids.length === 0 ? (
      t('proof.none')
    ) : (
      <p className="logbook__ids">
        <TxAnchors run={run} chainName={chainName} href={href} />
      </p>
    );
  return (
    <div className="logbook">
      <h3 className="logbook__title">{t('proof.recent')}</h3>
      <p className="logbook__lead">{t('proof.lead')}</p>
      <table className="logbook__table">
        <RunsHead />
        <tbody>
          {runs.slice(0, config.site.proofRuns).map((r, i) => (
            <tr key={`${r.utc}-${i}`} className={r.ok ? 'logbook__row' : 'logbook__row logbook__row--failed'}>
              <th scope="row" className="mono">
                {r.utc.replace('T', ' ').replace(/:\d\dZ$/, '')}
              </th>
              <td data-label={t('proof.col.flow')}>{t(`proof.flow.${r.flow}` as TextKey)}</td>
              <td data-label={t('proof.col.amount')} lang="en">
                {r.amount}
              </td>
              <td data-label={t('proof.col.time')}>{time(r.seconds)}</td>
              <td data-label={t('proof.col.result')}>
                <span className="logbook__result">{r.ok ? t('proof.ok') : t('proof.fail')}</span>
              </td>
              <td data-label={t('proof.col.txid')}>{links(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="logbook__wallets">{t('proof.wallets', { n: String(proof.wallets) })}</p>
    </div>
  );
}
