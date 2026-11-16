// The language menu in the top bar: a native select (phones give their own list), options from config.i18n.
import type { LoadedConfig } from './config';
import { setLang, useText } from './i18n';

export function LangPicker({ config }: { config: LoadedConfig | null }) {
  const { lang, t } = useText();
  // Until the config arrives the menu holds the shown language only, by the name its own lang file gives it.
  const languages = config?.i18n.languages ?? [{ code: lang, name: t('lang.name') }];
  return (
    <select className="topbar__lang" aria-label={t('lang.label')} value={lang} onChange={(e) => setLang(e.target.value)}>
      {languages.map(({ code, name }) => (
        <option key={code} value={code} lang={code}>
          {name}
        </option>
      ))}
    </select>
  );
}
