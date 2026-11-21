import { useEffect, useState } from 'react';
import { descriptionKey, heroSubKey, openFlows, openSymbols, symbolList, type TabId } from '../../core/flows';
import { ActionCard, cardTabs } from './ActionCard';
import { ActivityPage } from './activity/ActivityPage';
import { fetchConfig, useConfig } from './config';
import { Footer } from './Footer';
import { HeroChips } from './HeroChips';
import { useHealth } from './health';
import { routeOpenMap } from '../../core/client/health';
import { liveRoutes, routeClaims } from '../../core/route-claims';
import { routeNames } from './routeText';
import { JudgeBox, judgeBelow, JudgeStrip } from './JudgeStrip';
import { applyLanguages, useText } from './i18n';
import { LangPicker } from './LangPicker';
import { Scene } from './Scene';
import { CrossingPage } from './CrossingPage';
import { doneRoute, FinishedPage } from './cross/Finished';
import { DemoPage } from './demo/DemoPage';
import { HowPage } from './how/HowPage';
import { LegalPage } from './legal/LegalPage';
import { Measured } from './Measured';
import { HeroPitch } from './HeroPitch';
import { HeroProof } from './HeroProof';
import { PayPages, payRoute } from './pay/PayPages';
import { BalancePill } from './wallet/BalancePill';
import { useWallet } from './wallet/useWallet';
import { WatchPage } from './watch/WatchPage';

export function App() {
  const { t } = useText();
  const config = useConfig();
  // Hero text promises a crossing only while the route's last health check sees a live asset's chain open (KMN1).
  const health = useHealth();
  const flows = openFlows(config, health);
  const vars = { symbols: symbolList(openSymbols(config, health), t('text.and')) };
  // Who carries a crossing: every route with an open asset now (K6P1), not route.active alone.
  const routes = config ? liveRoutes(routeClaims(config, routeOpenMap(health))) : [];
  const description = config ? t(descriptionKey(flows), vars) : null;
  const wallet = useWallet(config, t('wallet.fakeName'));
  const [chosen, setChosen] = useState<TabId | null>(null);
  const [fill, setFill] = useState(0);
  const [serverDown, setServerDown] = useState(false);
  const heroCard = config?.ui.hero === 'card';
  const judge = config && flows.land && cardTabs(config).includes('in') ? config : null;
  const crossing = /^\/c\/([0-9a-f]{32})$/.exec(location.pathname)?.[1];
  const done = doneRoute(location.pathname);
  const how = location.pathname === '/how';
  const watch = location.pathname === '/watch';
  const activity = location.pathname === '/activity';
  // /demo only with features.demo; the server answers the 404 page while it is off.
  const demo = location.pathname === '/demo' && config?.features.demo === true;
  const legal = location.pathname === '/terms' ? 'terms' : location.pathname === '/risks' ? 'risks' : null;
  // Sampan Pay pages exist only with features.pay; until the config says so nothing is drawn, then the front page.
  const pay = payRoute(location.pathname);
  const payShown = pay && (config ? config.features.pay : !serverDown) ? pay : null;
  const front = !payShown && !watch && !activity && !demo && !how && !legal && !done && !crossing;
  // The header balance opens the Swap tab, where the full balance and Disconnect are (K5P6).
  const openWallet = (): void => {
    setChosen('swap');
    requestAnimationFrame(() => {
      const tab = document.getElementById('tab-swap');
      tab?.scrollIntoView({ block: 'nearest' });
      tab?.focus();
    });
  };

  useEffect(() => {
    fetchConfig().catch(() => setServerDown(true));
  }, []);

  useEffect(() => {
    if (config) applyLanguages(config.i18n);
  }, [config]);

  useEffect(() => {
    document.title = `${t('meta.title')} · ${t('banner.event')}`;
  }, [t]);

  useEffect(() => {
    if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  }, [description]);

  return (
    <>
      <nav className="topbar">
        <span className="wordmark">Sampan</span>
        <span className="topbar__end">
          <BalancePill config={config} wallet={wallet} onOpen={front ? openWallet : null} />
          <LangPicker config={config} />
        </span>
      </nav>
      {payShown ? (
        <main className="page">
          <PayPages route={payShown} config={config} />
        </main>
      ) : watch ? (
        <main className="page">
          <WatchPage config={config} />
        </main>
      ) : activity ? (
        <main className="page">
          <ActivityPage config={config} wallet={wallet} />
        </main>
      ) : demo ? (
        <main>
          <DemoPage config={config} />
        </main>
      ) : how ? (
        <main>
          <HowPage config={config} />
        </main>
      ) : legal ? (
        <main>
          <LegalPage kind={legal} config={config} />
        </main>
      ) : done ? (
        <main className="page">
          <FinishedPage id={done} config={config} />
        </main>
      ) : crossing ? (
        <main className="page">
          <CrossingPage id={crossing} config={config} />
        </main>
      ) : (
      <main className={judge ? 'page page--judge' : 'page'}>
        <section className={heroCard ? 'hero hero--card' : 'hero'}>
          <HeroPitch symbols={vars.symbols} />
          {config && heroCard ? <HeroChips config={config} cross={flows.cross} /> : null}
          {/* One real crossing, near the card (K6P6). */}
          {config ? <HeroProof config={config} /> : null}
          {config && !heroCard ? <p className="hero__sub">{t(heroSubKey(flows), vars)}</p> : null}
        </section>
        <Scene />
        {serverDown ? (
          <p className="server-down" role="alert">
            {t('error.server')}
          </p>
        ) : null}
        {judge ? (
          <JudgeStrip
            config={judge}
            onFill={() => {
              setChosen('in');
              setFill((n) => n + 1);
            }}
          />
        ) : null}
        <ActionCard config={config} wallet={wallet} chosen={chosen} onChoose={setChosen} fill={fill} />
        {judge && judgeBelow(judge) ? <JudgeBox config={judge} /> : null}
        {/* Below the card so the card and its one primary button stay on the first screen (ADR 0053). */}
        {/* ui.hero "card": the headline's longer sentence moves under the card, so the first screen is one line and the card. */}
        {config && heroCard ? <p className="hero__sub hero__sub--after">{t(heroSubKey(flows), vars)}</p> : null}
        {flows.cross && routes.length > 0 ? <p className="hero__honest">{t('hero.honest', { route: routeNames(t, routes) })}</p> : null}
        <Measured link />
      </main>
      )}
      <Footer />
    </>
  );
}
