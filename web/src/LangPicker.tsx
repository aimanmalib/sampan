// The language menu in the top bar: a native select (phones give their own list), options from config.i18n.
// The globe beside it is decoration (brand/brand.css).
import type { LoadedConfig } from './config';
import { setLang, useText } from './i18n';

export function LangPicker({ config }: { config: LoadedConfig | null }) {
  const { lang, t } = useText();
  // Until the config arrives the menu holds the shown language only, by the name its own lang file gives it.
  const languages = config?.i18n.languages ?? [{ code: lang, name: t('lang.name') }];
  return (
    <span className="lang">
      <svg className="lang__globe" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="7.25" />
        <path d="M2.75 10h14.5M10 2.75c2.2 2 3.3 4.4 3.3 7.25s-1.1 5.25-3.3 7.25c-2.2-2-3.3-4.4-3.3-7.25S7.8 4.75 10 2.75z" />
      </svg>
      <select className="topbar__lang" aria-label={t('lang.label')} value={lang} onChange={(e) => setLang(e.target.value)}>
        {languages.map(({ code, name }) => (
          <option key={code} value={code} lang={code}>
            {name}
          </option>
        ))}
      </select>
    </span>
  );
}
