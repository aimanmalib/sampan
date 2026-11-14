// UI text lives in lang/*.json. This module picks the language and fills {placeholders}.
import { useSyncExternalStore } from 'react';
import en from '../../lang/en.json';
import ms from '../../lang/ms.json';

export type Lang = 'en' | 'ms';
export type TextKey = keyof typeof en;

const dictionaries: Record<Lang, Record<TextKey, string>> = { en, ms };
const STORAGE_KEY = 'sampan.lang';
const listeners = new Set<() => void>();

function initialLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'ms' ? 'ms' : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = initialLang();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  document.documentElement.lang = lang;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function translate(lang: Lang, key: TextKey, vars: Record<string, string> = {}): string {
  const text = dictionaries[lang][key] ?? dictionaries.en[key];
  return text.replace(/\{(\w+)\}/g, (_m, name: string) => vars[name] ?? `{${name}}`);
}

export function useText(): { lang: Lang; t: (key: TextKey, vars?: Record<string, string>) => string } {
  const lang = useSyncExternalStore(subscribe, () => current);
  return { lang, t: (key, vars) => translate(lang, key, vars) };
}
