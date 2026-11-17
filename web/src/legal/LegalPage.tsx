// /terms and /risks: sections listed in config (legal.terms, legal.risks), text in lang/ under terms.<key>.* and
// risks.<key>.*. A section marked `cross` is shown only while cross-chain flows are open (same rule as the front page).
import { openFlows } from '../../../core/flows';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import './legal.css';

export type LegalKind = 'terms' | 'risks';

export function LegalPage({ kind, config }: { kind: LegalKind; config: LoadedConfig | null }) {
  const { lang, t } = useText();
  if (!config) return null;
  const cross = openFlows(config).cross;
  const v = {
    operator: config.legal.operator,
    route: t(`route.${config.route.active}` as TextKey),
    symbol: config.tokens[config.defaultToken]?.symbol ?? '',
    blocks: String(config.landing.returnAfterBlocks),
    dust: config.landing.dustSats.toLocaleString('en-US'),
  };
  const sections = config.legal[kind].filter((s) => !s.cross || cross);
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
