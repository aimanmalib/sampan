// "What each route takes" on /how (K6P5): every live route of docs/route-facts.json as it was when the page was built,
// with the measured time (median, runs, range), the signatures counted in the e2e run and the fee at USD 2, 20 and 100
// from the dated quotes. The same words as the hero line and the READMEs (core/route-facts-text.ts).
import facts from 'virtual:sampan-route-facts';
import { FEE_AMOUNTS } from '../../../core/route-facts';
import { feeCell, quotedAt, routeName, signaturesText, timeCell, utc } from '../../../core/route-facts-text';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import './facts.css';

export function RouteFactsTable({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  if (facts.routes.length === 0) return null;
  const text = (key: string, vars?: Record<string, string>): string => t(key as TextKey, vars);
  const chainName = (key: string): string => config.evm.chains.find((c) => c.key === key)?.name ?? key;
  const at = quotedAt(facts);
  const feeCol = (a: string): string => t('facts.col.fee', { at: `$${a}` });
  return (
    <section className="proof facts" id="route-facts" aria-labelledby="route-facts-title">
      <h2 id="route-facts-title">{t('facts.title')}</h2>
      {at ? <p>{t('facts.lead', { at: utc(at) })}</p> : null}
      <table className="proof__table facts__table">
        <thead>
          <tr>
            <th scope="col">{t('facts.col.route')}</th>
            <th scope="col">{t('facts.col.time')}</th>
            <th scope="col">{t('facts.col.signatures')}</th>
            {FEE_AMOUNTS.map((a) => (
              <th scope="col" key={a}>
                {feeCol(a)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {facts.routes.map((f) => (
            <tr key={f.id} data-route-fact={f.id}>
              <th scope="row">{routeName(f, text, chainName)}</th>
              <td data-label={t('facts.col.time')}>{timeCell(f, text)}</td>
              <td data-label={t('facts.col.signatures')}>{signaturesText(f, text)}</td>
              {FEE_AMOUNTS.map((a) => (
                <td key={a} data-label={feeCol(a)}>
                  {feeCell(f.fees[a], text)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="proof__full">{t('facts.easier')}</p>
    </section>
  );
}
