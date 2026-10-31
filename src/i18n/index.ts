import en from './en.json';
import ru from './ru.json';

/** Every key must exist in en.json; other languages fall back to English for missing keys. */
export type TextKey = keyof typeof en;
export type Lang = 'en' | 'ru';

const TABLES: Record<Lang, Partial<Record<TextKey, string>>> = { en, ru };

let current: Lang = 'en';

export function detectLang(preferred: readonly string[]): Lang {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'ru') return 'ru';
    if (base === 'en') return 'en';
  }
  return 'en';
}

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

/** True if a key exists (in English, which every key must have). */
export function hasText(key: string): key is TextKey {
  return key in en;
}

/** Looks up a player-facing string. `{name}` placeholders are filled from `params`. */
export function t(key: TextKey, params?: Record<string, string | number>): string {
  const text = TABLES[current][key] ?? en[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}
