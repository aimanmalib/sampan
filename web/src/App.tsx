import { useEffect } from 'react';
import { descriptionKey, heroSubKey, openFlows, symbolList } from '../../core/flows';
import { ActionCard } from './ActionCard';
import { useConfig } from './config';
import { Footer } from './Footer';
import { setLang, useText } from './i18n';
import { Scene } from './Scene';
import { CrossingPage } from './CrossingPage';
import { useWallet } from './wallet/useWallet';

export function App() {
  const { lang, t } = useText();
  const config = useConfig();
  const route = config?.route.active ?? 'none';
  const flows = openFlows(config);
  const vars = { symbols: symbolList(config?.route.symbols ?? [], t('text.and')) };
  const description = config ? t(descriptionKey(flows), vars) : null;
  const wallet = useWallet(config, t('wallet.fakeName'));
  const crossing = /^\/c\/([0-9a-f]{32})$/.exec(location.pathname)?.[1];

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
        <button
          type="button"
          className="topbar__lang"
          lang={lang === 'en' ? 'ms' : 'en'}
          aria-label={t('lang.switchLabel')}
          onClick={() => setLang(lang === 'en' ? 'ms' : 'en')}
        >
          {t('lang.switch')}
        </button>
      </nav>
      {crossing ? (
        <main className="page">
          <CrossingPage id={crossing} config={config} />
        </main>
      ) : (
      <main className="page">
        <section className="hero">
          <h1 className="hero__title">{t('hero.title')}</h1>
          {config ? <p className="hero__sub">{t(heroSubKey(flows), vars)}</p> : null}
          {flows.cross && route !== 'none' ? <p className="hero__honest">{t('hero.honest', { route: t(`route.${route}`) })}</p> : null}
        </section>
        <Scene />
        <ActionCard config={config} wallet={wallet} />
      </main>
      )}
      <Footer />
    </>
  );
}
