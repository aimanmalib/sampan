import { useEffect, useState } from 'react';
import { descriptionKey, heroSubKey, openFlows, openSymbols, symbolList, type TabId } from '../../core/flows';
import { ActionCard, cardTabs } from './ActionCard';
import { fetchConfig, useConfig } from './config';
import { Footer } from './Footer';
import { useHealth } from './health';
import { JudgeStrip } from './JudgeStrip';
import { applyLanguages, useText } from './i18n';
import { LangPicker } from './LangPicker';
import { Scene } from './Scene';
import { CrossingPage } from './CrossingPage';
import { doneRoute, FinishedPage } from './cross/Finished';
import { HowPage } from './how/HowPage';
import { LegalPage } from './legal/LegalPage';
import { Measured } from './Measured';
import { PayPages, payRoute } from './pay/PayPages';
import { useWallet } from './wallet/useWallet';
import { WatchPage } from './watch/WatchPage';

export function App() {
  const { t } = useText();
  const config = useConfig();
  const route = config?.route.active ?? 'none';
  // Hero text promises a crossing only while the route's last health check sees a live asset's chain open (KMN1).
  const health = useHealth();
  const flows = openFlows(config, health);
  const vars = { symbols: symbolList(openSymbols(config, health), t('text.and')) };
  const description = config ? t(descriptionKey(flows), vars) : null;
  const wallet = useWallet(config, t('wallet.fakeName'));
  const [chosen, setChosen] = useState<TabId | null>(null);
  const [fill, setFill] = useState(0);
  const [serverDown, setServerDown] = useState(false);
  const judge = config && flows.land && cardTabs(config).includes('in') ? config : null;
  const crossing = /^\/c\/([0-9a-f]{32})$/.exec(location.pathname)?.[1];
  const done = doneRoute(location.pathname);
  const how = location.pathname === '/how';
  const watch = location.pathname === '/watch';
  const legal = location.pathname === '/terms' ? 'terms' : location.pathname === '/risks' ? 'risks' : null;
  // Sampan Pay pages exist only with features.pay; until the config says so nothing is drawn, then the front page.
  const pay = payRoute(location.pathname);
  const payShown = pay && (config ? config.features.pay : !serverDown) ? pay : null;

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
        <LangPicker config={config} />
      </nav>
      {payShown ? (
        <main className="page">
          <PayPages route={payShown} config={config} />
        </main>
      ) : watch ? (
        <main className="page">
          <WatchPage config={config} />
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
        <section className="hero">
          <h1 className="hero__title">{t('hero.title')}</h1>
          {config ? <p className="hero__sub">{t(heroSubKey(flows), vars)}</p> : null}
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
        {/* Below the card so the card and its one primary button stay on the first screen (ADR 0053). */}
        {flows.cross && route !== 'none' ? <p className="hero__honest">{t('hero.honest', { route: t(`route.${route}`) })}</p> : null}
        <Measured link />
      </main>
      )}
      <Footer />
    </>
  );
}
