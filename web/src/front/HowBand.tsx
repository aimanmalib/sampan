// "How Sampan works" on the front page: each open flow as one crossing (where it starts, what stands in the middle,
// where it ends) with the sentence /how gives it, and the whole landing contract beside them. A flow whose flag is
// off is not drawn, and a crossing between chains only while the route's last health check sees it open (the hero's
// rule, core/flows.ts). Chains and routes are read from config (core/route-claims.ts), never written here. The
// crossing between chains carries the two sentences of the notice before a first crossing (who carries it, who signs,
// what happens when the route cannot finish); which asset reaches which chain is the river below (Harbour.tsx), so
// no sentence here repeats a network's name beside an asset (the card's own network list is the one place for that).
import source from '../../../contracts/landing.cash?raw';
import { routeOpenMap } from '../../../core/client/health';
import type { OpenFlows } from '../../../core/flows';
import { liveRoutes, routeClaims } from '../../../core/route-claims';
import { ChipIcon } from '../chips/Chip';
import type { LoadedConfig } from '../config';
import { useHealth } from '../health';
import { useText, type TextKey } from '../i18n';
import { routeNames } from '../routeText';
import { Crossing } from './Crossing';

const LINES = source.replace(/\s+$/, '').split('\n');

export function HowBand({ config, flows }: { config: LoadedConfig; flows: OpenFlows }) {
  const { t } = useText();
  const health = useHealth();
  if (!flows.land && !flows.swap && !flows.cross) return null;
  const symbol = config.tokens[config.defaultToken]?.symbol ?? '';
  const v = { symbol, blocks: String(config.landing.returnAfterBlocks) };
  // What a crossing reaches right now and who carries it: the rows the hero chips and the network lists read.
  const claims = flows.cross ? routeClaims(config, routeOpenMap(health)).filter((c) => c.out.length + c.in.length > 0) : [];
  const routes = liveRoutes(claims);
  const carriers = routes.map((r) => t(`route.${r}` as TextKey));
  const repo = config.banner.repoUrl;
  return (
    <section className="story__part story__part--deep howband" id="how" aria-labelledby="howband-title">
      <div className="story__in">
        <header className="howband__head">
          <h2 className="story__title" id="howband-title">
            {t('how.title')}
          </h2>
          <p className="story__lead">{t('how.lead')}</p>
        </header>
        <div className={flows.land ? 'howband__body howband__body--source' : 'howband__body'}>
          <ol className="howband__flows">
            {flows.land ? (
              <li className="flow">
                <h3 className="flow__title">{t('how.land.title')}</h3>
                <Crossing
                  label={t('how.land.title')}
                  from={[{ text: t('how.land.d.wallet') }]}
                  via={[{ text: t('how.land.d.contract') }]}
                  to={[{ text: t('how.land.d.convert', v) }]}
                  note={t('how.land.d.back', v)}
                />
                <p className="flow__text">{t('how.land.text', v)}</p>
              </li>
            ) : null}
            {flows.swap ? (
              <li className="flow">
                <h3 className="flow__title">{t('how.swap.title')}</h3>
                <Crossing
                  label={t('how.swap.title')}
                  from={[{ text: t('how.swap.d.wallet') }]}
                  via={[{ text: t('how.swap.d.pools') }]}
                  to={[{ text: t('how.swap.d.wallet') }]}
                />
                <p className="flow__text">{t('how.swap.text', v)}</p>
              </li>
            ) : null}
            {claims.length > 0 ? (
              <li className="flow" data-flow="cross">
                <h3 className="flow__title">{t('how.cross.title')}</h3>
                <Crossing
                  label={t('how.cross.title')}
                  bothWays
                  from={[{ text: `${t('how.cross.d.bch')} · ${symbol}`, icon: <ChipIcon config={config} name="BCH" /> }]}
                  via={carriers.map((text) => ({ text }))}
                  to={claims.map((c) => ({ text: c.name, icon: <ChipIcon config={config} name={c.key} /> }))}
                />
                {/* Who carries a crossing and who signs it, in the words of the notice before a first crossing. Which
                    assets reach which chain is the river under this band. */}
                <p className="flow__text">{t('disclose.route', { route: routeNames(t, routes) })}</p>
                <p className="flow__text">{t('disclose.final')}</p>
              </li>
            ) : null}
          </ol>
          {flows.land ? (
            <aside className="source" aria-labelledby="source-title">
              <h3 className="source__title" id="source-title">
                {t('how.source.title')}
              </h3>
              <p className="source__text">{t('how.source.text')}</p>
              <pre className="source__code" tabIndex={0}>
                <code>
                  {/* Each line keeps its own line break (all but the last), so the text reads and copies as the file
                      does even with no stylesheet; a comment line is only set quieter. */}
                  {LINES.map((line, i) => (
                    <span key={i} className={line.trimStart().startsWith('//') ? 'source__line source__line--note' : 'source__line'}>
                      {i < LINES.length - 1 ? `${line}\n` : line}
                    </span>
                  ))}
                </code>
              </pre>
              <p className="source__links">
                {repo ? <a href={`${repo}/blob/main/contracts/landing.cash`}>{t('how.source.link')}</a> : null}
                <a href="/how">{t('how.verify.title')}</a>
              </p>
            </aside>
          ) : null}
        </div>
      </div>
    </section>
  );
}
