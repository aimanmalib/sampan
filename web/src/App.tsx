import { useEffect } from 'react';
import { ActionCard } from './ActionCard';
import { useConfig } from './config';
import { Footer } from './Footer';
import { setLang, useText } from './i18n';
import { Scene } from './Scene';

export function App() {
  const { lang, t } = useText();
  const config = useConfig();
  const route = config?.route.active ?? 'none';

  useEffect(() => {
    document.title = `${t('meta.title')} · ${t('banner.event')}`;
  }, [t]);

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
      <main className="page">
        <section className="hero">
          <h1 className="hero__title">{t('hero.title')}</h1>
          <p className="hero__sub">{t(route === 'near-intents' ? 'hero.sub.near-intents' : 'hero.sub.thorchain')}</p>
          {route !== 'none' ? <p className="hero__honest">{t('hero.honest', { route: t(`route.${route}`) })}</p> : null}
        </section>
        <Scene />
        <ActionCard />
      </main>
      <Footer />
    </>
  );
}
