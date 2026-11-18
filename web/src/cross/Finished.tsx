// "See a finished crossing": Send out and Bring in link to one measured crossing per direction
// (config site.finished), and /done/<BCH txid> shows that Runs row of docs/MEASURED.md as read when the page was
// built: when, how much, the measured time and every transaction id with its explorer. Nothing is fetched, so a
// judge can check both directions without funds on another chain and without waiting.
import proof from 'virtual:sampan-proof';
import { finishedCrossing, type ProofRun } from '../../../core/proof';
import type { LoadedConfig } from '../config';
import { runText } from '../how/txLinks';
import { useText } from '../i18n';

export type FinishedFlow = 'out' | 'in';

export const donePath = (bchTxid: string): string => `/done/${bchTxid}`;

/** The txid of a /done/ path, or undefined. */
export const doneRoute = (pathname: string): string | undefined => /^\/done\/([0-9a-f]{64})$/.exec(pathname)?.[1];

/** The link under a tab's form; nothing when config names no crossing or the measurements lack it. */
export function FinishedLink({ config, flow }: { config: LoadedConfig; flow: FinishedFlow }) {
  const { t } = useText();
  const id = config.site.finished[flow];
  if (!finishedCrossing(proof, flow, id)) return null;
  return (
    <p className="done-link">
      <a href={donePath(id)} data-finished={flow}>
        {t('done.link')}
      </a>
    </p>
  );
}

function found(id: string): ProofRun | null {
  return finishedCrossing(proof, 'out', id) ?? finishedCrossing(proof, 'in', id);
}

export function FinishedPage({ id, config }: { id: string; config: LoadedConfig | null }) {
  const { t } = useText();
  const run = found(id);
  if (!config || !run) {
    return (
      <section className="crossing">
        <h1 className="crossing__title">{t('done.title')}</h1>
        <p className="card__note">{t(config ? 'done.missing' : 'crossing.loading')}</p>
      </section>
    );
  }
  const { chainName, href, time } = runText(config, t);
  return (
    <section className="crossing done" data-done={run.flow}>
      <h1 className="crossing__title">{t('done.title')}</h1>
      <p className="crossing__kind">{t(run.flow === 'out' ? 'proof.flow.out' : 'proof.flow.in')}</p>
      <p className="crossing__status">{t('done.lead')}</p>
      <dl className="done__facts">
        <div>
          <dt>{t('done.when')}</dt>
          <dd className="mono">{run.utc.replace('T', ' ').replace(/Z$/, '')}</dd>
        </div>
        <div>
          <dt>{t('done.amount')}</dt>
          <dd lang="en">{run.amount}</dd>
        </div>
        <div>
          <dt>{t('done.time')}</dt>
          <dd data-seconds={run.seconds ?? ''}>{time(run.seconds)}</dd>
        </div>
        {run.txids.map((x, i) => (
          <div key={x.id}>
            <dt>{x.chain !== 'bch' ? chainName(x.chain) : i === 0 ? t('done.tx.bch') : t('done.tx.convert')}</dt>
            <dd>
              <a className="mono" href={href(x)} target="_blank" rel="noreferrer" data-chain={x.chain}>
                {x.id}
              </a>
            </dd>
          </div>
        ))}
      </dl>
      <p className="crossing__actions">
        <a href="/how#proof">{t('done.more')}</a>
        <a href="/">{t('done.back')}</a>
      </p>
    </section>
  );
}
