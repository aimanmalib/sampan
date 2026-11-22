// /faq: the questions listed in config.faq.items, then who holds the funds at each step (config.faq.custody).
// Words in lang/ under faq.*; the layout reuses the reading column of /terms and /risks.
import { openFlows } from '../../../core/flows';
import { shownCustody } from '../../../core/faq';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import '../legal/legal.css';
import './faq.css';

/** Values the answers fill in, all read from config. */
function faqVars(config: LoadedConfig): Record<string, string> {
  const token = config.tokens[config.defaultToken];
  return {
    symbol: token?.symbol ?? '',
    name: token?.name ?? '',
    blocks: String(config.landing.returnAfterBlocks),
    fee: String(config.business.feeBps / 100),
  };
}

export function FaqPage({ config }: { config: LoadedConfig | null }) {
  const { t } = useText();
  if (!config) return null;
  const v = faqVars(config);
  const key = (k: string): TextKey => k as TextKey;
  const custody = shownCustody(config.faq, openFlows(config).cross);
  return (
    <article className="legal faq">
      <p className="legal__back">
        <a href="/">{t('how.back')}</a>
      </p>
      <h1 className="legal__title">{t('faq.title')}</h1>
      <p className="legal__lead">{t('faq.lead')}</p>
      <ol className="legal__list">
        {config.faq.items.map((item) => (
          <li key={item} className="legal__item" id={item}>
            <h2>{t(key(`faq.${item}.q`), v)}</h2>
            <p>{t(key(`faq.${item}.a`), v)}</p>
          </li>
        ))}
      </ol>
      <section className="faq__hold" id="hold" aria-labelledby="faq-hold-title">
        <h2 id="faq-hold-title" className="faq__hold-title">{t('faq.hold.title')}</h2>
        <p className="faq__hold-lead">{t('faq.hold.lead')}</p>
        <ol className="faq__steps">
          {custody.map((s) => (
            <li key={s.key} className="faq__step" id={`hold-${s.key}`}>
              <h3>{t(key(`faq.hold.${s.key}.title`), v)}</h3>
              <p>{t(key(`faq.hold.${s.key}.text`), v)}</p>
            </li>
          ))}
        </ol>
        <p className="faq__more">
          <a href="/risks">{t('faq.more')}</a>
        </p>
      </section>
      <p className="legal__other">
        <a href="/how">{t('footer.how')}</a>
        <a href="/risks">{t('footer.risks')}</a>
        <a href="/terms">{t('footer.terms')}</a>
      </p>
    </article>
  );
}
