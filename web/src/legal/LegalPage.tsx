// /terms and /risks: sections listed in config (legal.terms, legal.risks), text in lang/ under terms.<key>.* and
// risks.<key>.*. Which sections are shown: ./sections.ts. A `verbatim` part is quoted in English in every language
// (the provider's terms ask for its exact words) and translated under the quote.
import type { LoadedConfig } from '../config';
import { translate, useText, type TextKey } from '../i18n';
import { shownSections, type LegalKind } from './sections';
import './legal.css';

export type { LegalKind } from './sections';

export function LegalPage({ kind, config }: { kind: LegalKind; config: LoadedConfig | null }) {
  const { lang, t } = useText();
  if (!config) return null;
  const v = {
    operator: config.legal.operator,
    route: t(`route.${config.route.active}` as TextKey),
    symbol: config.tokens[config.defaultToken]?.symbol ?? '',
    blocks: String(config.landing.returnAfterBlocks),
    dust: config.landing.dustSats.toLocaleString('en-US'),
  };
  const sections = shownSections(config, kind);
  const key = (name: string, part: string): TextKey => `${kind}.${name}.${part}` as TextKey;
  return (
    <article className="legal">
      <p className="legal__back">
        <a href="/">{t('how.back')}</a>
      </p>
      <h1 className="legal__title">{t(`legal.${kind}.title`)}</h1>
      <p className="legal__lead">{t(`legal.${kind}.lead`)}</p>
      <ol className="legal__list">
        {sections.map((s) => (
          <li key={s.key} className="legal__item" id={s.key}>
            <h2>{t(key(s.key, 'title'), v)}</h2>
            <p>{t(key(s.key, 'text'), v)}</p>
            {s.list ? (
              <ul className="legal__points">
                {s.list.map((item) => (
                  <li key={item}>{t(key(s.key, `list.${item}`), v)}</li>
                ))}
              </ul>
            ) : null}
            {s.verbatim ? (
              <>
                <p className="legal__verbatim-lead">{t(key(s.key, `${s.verbatim}Lead`), v)}</p>
                <blockquote className="legal__verbatim" lang="en">
                  {translate('en', key(s.key, s.verbatim), v)}
                </blockquote>
                {lang !== 'en' ? (
                  <p className="legal__verbatim-translation">
                    <strong>{t('legal.translationLabel')}</strong> {t(key(s.key, s.verbatim), v)}
                  </p>
                ) : null}
              </>
            ) : null}
            {kind === 'risks' ? (
              <p className="legal__funds">
                <strong>{t('legal.funds')}</strong> {t(key(s.key, 'funds'), v)}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="legal__updated">{t('legal.updated')}</p>
      {lang !== 'en' ? <p className="legal__updated">{t('legal.translation')}</p> : null}
      <p className="legal__other">
        <a href={kind === 'terms' ? '/risks' : '/terms'}>{t(kind === 'terms' ? 'footer.risks' : 'footer.terms')}</a>
        <a href="/how">{t('footer.how')}</a>
      </p>
    </article>
  );
}
