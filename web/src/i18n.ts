// UI text lives in lang/*.json. This module picks the language and fills {placeholders}.
// Which languages the page offers, in which order and under which name, comes from config.i18n (GET /api/config);
// a lang file alone offers nothing. Every key falls back to English.
import { useSyncExternalStore } from 'react';
import type { I18nConfig } from '../../core/config';
import en from '../../lang/en.json';
import { knownLang as known, pickLang } from './lang-pick';

export type Lang = string;
export type TextKey = keyof typeof en;
type Dictionary = Partial<Record<TextKey, string>>;

const files = import.meta.glob<Dictionary>('../../lang/*.json', { eager: true, import: 'default' });
const dictionaries: Record<Lang, Dictionary> = Object.fromEntries(
  Object.entries(files).map(([file, text]) => [/([\w-]+)\.json$/.exec(file)![1]!, text]),
);
const STORAGE_KEY = 'sampan.lang';
const codes = Object.keys(dictionaries);
const listeners = new Set<() => void>();

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function knownLang(code: string | null | undefined): Lang {
  return known(code, codes);
}

let current: Lang = knownLang(stored());
if (typeof document !== 'undefined') document.documentElement.lang = current;

function show(lang: Lang): void {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  listeners.forEach((fn) => fn());
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  show(knownLang(lang));
}

/** Once the config is here: see pickLang. The default is not saved, so a later config change still applies. */
export function applyLanguages(i18n: I18nConfig): void {
  const next = pickLang(i18n, stored(), codes);
  if (next !== current) show(next);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function translate(lang: Lang, key: TextKey, vars: Record<string, string> = {}): string {
  const text = dictionaries[lang]?.[key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (_m, name: string) => vars[name] ?? `{${name}}`);
}

export function useText(): { lang: Lang; t: (key: TextKey, vars?: Record<string, string>) => string } {
  const lang = useSyncExternalStore(subscribe, () => current);
  return { lang, t: (key, vars) => translate(lang, key, vars) };
}
