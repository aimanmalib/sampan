// "What was measured on mainnet" on /how: counts per flow and the newest runs, read from docs/MEASURED.md when the
// page was built (virtual:sampan-proof). Every transaction id opens in an explorer; crossing rows are shown as
// measurements only, whatever the flags say.
import proof from 'virtual:sampan-proof';
import { SECONDS_UP_TO } from '../../../core/client/measured';
import type { ProofRun, ProofTxid } from '../../../core/proof';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';

const short = (id: string): string => `${id.slice(0, id.startsWith('0x') ? 10 : 8)}…${id.slice(-6)}`;

export function ProofTable({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  if (proof.runs.length === 0) return null;
  const explorer = (chain: string): string => config.evm.chains.find((c) => c.key.toLowerCase() === chain)?.explorer ?? '';
  const href = (x: ProofTxid): string => (x.chain === 'bch' ? config.connect.explorerTxUrl.replace('{txid}', x.id) : `${explorer(x.chain)}/tx/${x.id}`);
  const time = (s: number | null): string =>
    s === null ? t('proof.none') : s < SECONDS_UP_TO ? t('measured.seconds', { n: s.toFixed(1) }) : t('measured.minutes', { n: String(Math.round(s / 60)) });
  const flowName = (f: ProofRun['flow']): string => t(`proof.flow.${f}` as TextKey);
  const links = (run: ProofRun) =>
    run.txids.length === 0 ? (
      t('proof.none')
    ) : (
      <span className="proof__ids">
        {run.txids.map((x) => (
          <a key={x.id} className="mono" href={href(x)} target="_blank" rel="noreferrer" title={x.id}>
            {run.txids.length > 1 ? `${t(`proof.chain.${x.chain}` as TextKey)} ` : ''}
            {short(x.id)}
          </a>
        ))}
      </span>
    );
  const repo = config.banner.repoUrl;
  return (
    <section className="proof" id="proof" aria-labelledby="proof-title">
      <h2 id="proof-title">{t('proof.title')}</h2>
      <p>{t('proof.lead')}</p>
      <p className="proof__wallets">{t('proof.wallets', { n: String(proof.wallets) })}</p>
      <table className="proof__table proof__table--flows">
        <thead>
          <tr>
            <th scope="col">{t('proof.col.flow')}</th>
            <th scope="col">{t('proof.col.ok')}</th>
            <th scope="col">{t('proof.col.fail')}</th>
            <th scope="col">{t('proof.col.median')}</th>
            <th scope="col">{t('proof.col.first')}</th>
          </tr>
        </thead>
        <tbody>
          {proof.flows.map((f) => (
            <tr key={f.flow} data-flow={f.flow}>
              <th scope="row">{flowName(f.flow)}</th>
              <td data-label={t('proof.col.ok')}>
                {f.ok}
                {f.unproven > 0 ? ` ${t('proof.unproven', { n: String(f.unproven) })}` : ''}
              </td>
              <td data-label={t('proof.col.fail')}>{f.fail}</td>
              <td data-label={t('proof.col.median')}>{time(f.medianSeconds)}</td>
              <td data-label={t('proof.col.first')}>{f.first ? links(f.first) : t('proof.none')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{t('proof.recent')}</h3>
      <table className="proof__table proof__table--runs">
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
        <tbody>
          {proof.runs.slice(0, config.site.proofRuns).map((r, i) => (
            <tr key={`${r.utc}-${i}`}>
              <th scope="row" className="mono">{r.utc.replace('T', ' ').replace(/:\d\dZ$/, '')}</th>
              <td data-label={t('proof.col.flow')}>{flowName(r.flow)}</td>
              <td data-label={t('proof.col.amount')} lang="en">{r.amount}</td>
              <td data-label={t('proof.col.time')}>{time(r.seconds)}</td>
              <td data-label={t('proof.col.result')}>{r.ok ? t('proof.ok') : t('proof.fail')}</td>
              <td data-label={t('proof.col.txid')}>{links(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="proof__full">
        {repo ? <a href={`${repo}/blob/main/docs/MEASURED.md`}>{t('proof.full')}</a> : t('proof.fullFile')}
      </p>
    </section>
  );
}
