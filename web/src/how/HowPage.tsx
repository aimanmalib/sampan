// /how: what each open flow does, the whole landing contract, how to check an address and finish a landing without
// Sampan, and what already exists. A flow whose flag is off is not described (same rule as the front page).
import { openFlows, symbolList } from '../../../core/flows';
import { useEffect } from 'react';
import source from '../../../contracts/landing.cash?raw';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import { Measured } from '../Measured';
import { Diagram } from './Diagram';
import { ProofTable } from './ProofTable';
import './how.css';

export function HowPage({ config }: { config: LoadedConfig | null }) {
  const { t } = useText();
  // The page is drawn after the config arrives, so the browser's own jump to #proof finds nothing: do it once here.
  useEffect(() => {
    if (config && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [config]);
  if (!config) return null;
  const flows = openFlows(config);
  const symbol = config.tokens[config.defaultToken]?.symbol ?? '';
  const blocks = String(config.landing.returnAfterBlocks);
  const route = t(`route.${config.route.active}` as TextKey);
  const symbols = symbolList(config.route.symbols, t('text.and'));
  const v = { symbol, blocks, route, symbols };
  const repo = config.banner.repoUrl;
  return (
    <article className="how">
      <p className="how__back">
        <a href="/">{t('how.back')}</a>
      </p>
      <h1 className="how__title">{t('how.title')}</h1>
      <p className="how__lead">{t('how.lead')}</p>

      {flows.land ? (
        <section className="how__flow">
          <h2>{t('how.land.title')}</h2>
          <Diagram
            label={t('how.land.title')}
            steps={[
              { label: t('how.land.d.wallet') },
              { label: t('how.land.d.contract'), tone: 'contract' },
              { label: t('how.land.d.convert', v), note: t('how.land.d.back', v) },
            ]}
          />
          <p>{t('how.land.text', v)}</p>
        </section>
      ) : null}
      {flows.swap ? (
        <section className="how__flow">
          <h2>{t('how.swap.title')}</h2>
          <Diagram
            label={t('how.swap.title')}
            steps={[{ label: t('how.swap.d.wallet') }, { label: t('how.swap.d.pools'), tone: 'contract' }, { label: t('how.swap.d.wallet') }]}
          />
          <p>{t('how.swap.text', v)}</p>
        </section>
      ) : null}
      {flows.cross ? (
        <section className="how__flow">
          <h2>{t('how.cross.title')}</h2>
          <Diagram
            label={t('how.cross.title')}
            steps={[{ label: t('how.cross.d.bch') }, { label: route, tone: 'contract' }, { label: t('how.cross.d.base') }]}
          />
          <p>{t('how.cross.text', v)}</p>
        </section>
      ) : null}

      {flows.land ? (
        <>
          <section>
            <h2>{t('how.source.title')}</h2>
            <p>{t('how.source.text')}</p>
            <pre className="how__source" tabIndex={0}>
              <code>{source}</code>
            </pre>
            {repo ? (
              <p>
                <a href={`${repo}/blob/main/contracts/landing.cash`}>{t('how.source.link')}</a>
              </p>
            ) : null}
          </section>
          <section>
            <h2>{t('how.verify.title')}</h2>
            <p>{t('how.verify.text')}</p>
            <pre className="how__command">
              <code>{'npm ci\nnpm run verify-landing -- card.json'}</code>
            </pre>
            <p>{t('how.verify.after')}</p>
          </section>
          <section>
            <h2>{t('how.finish.title')}</h2>
            <p>{t('how.finish.optional')}</p>
            <p>{t('how.finish.text', v)}</p>
            <pre className="how__command">
              <code>{'npm run finisher -- card.json'}</code>
            </pre>
            <p>{t('how.finish.after')}</p>
          </section>
        </>
      ) : null}

      <section>
        <h2>{t('how.exists.title')}</h2>
        <p className="how__checked">{t('how.exists.checked')}</p>
        <ul>
          <li>{t('how.exists.cauldron')}</li>
          <li>{t('how.exists.paytaca')}</li>
        </ul>
        <p>{t('how.exists.gap', v)}</p>
        <h3>{t('how.adds.title')}</h3>
        <ul>
          {flows.land ? <li>{t('how.adds.land', v)}</li> : null}
          {flows.cross ? <li>{t('how.adds.cross', v)}</li> : null}
        </ul>
        {config.features.pay ? (
          <p className="how__pay">
            {t('how.pay.text')} <a href="/pay">{t('how.pay.link')}</a>
          </p>
        ) : null}
      </section>
      <Measured />
      <ProofTable config={config} />
    </article>
  );
}
