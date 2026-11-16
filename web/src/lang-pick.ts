// Which language to show, as pure functions of the config, the stored choice and the lang files present.
import type { I18nConfig } from '../../core/config.js';

export const FALLBACK_LANG = 'en';

/** A code the page can show: one with a lang file. Anything else, including nothing stored, is English. */
export function knownLang(code: string | null | undefined, files: readonly string[]): string {
  return code && files.includes(code) ? code : FALLBACK_LANG;
}

/**
 * Once the config is here: the visitor's own choice if config still offers it and its file exists, otherwise the
 * config default, otherwise English.
 */
export function pickLang(i18n: I18nConfig, stored: string | null, files: readonly string[]): string {
  const offered = (code: string | null): code is string => i18n.languages.some((l) => l.code === code) && knownLang(code, files) === code;
  return offered(stored) ? stored : offered(i18n.default) ? i18n.default : FALLBACK_LANG;
}
