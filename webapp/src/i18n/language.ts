/**
 * The interface language (#443). `system` follows the browser's own language
 * list; the other two pin it. Applied as `lang` on `<html>` so screen readers
 * and hyphenation follow the text.
 *
 * Only what the app itself says is translated. Text the device produces - a
 * problem `detail`, a parse error - is shown as the device said it (D-45).
 */
export type Language = 'en' | 'sv';

export type LanguagePreference = 'system' | Language;

export const LANGUAGES: readonly Language[] = ['en', 'sv'];

export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ['system', 'en', 'sv'];

export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = 'system';

export const LANGUAGE_STORAGE_KEY = 'rt_settings_language';

export function parseLanguagePreference(value: string | null): LanguagePreference {
  return LANGUAGE_PREFERENCES.find((preference) => preference === value) ?? DEFAULT_LANGUAGE_PREFERENCE;
}

function isLanguage(value: string): value is Language {
  return LANGUAGES.some((language) => language === value);
}

/**
 * The language to render in. For `system`, the first entry in the browser's
 * preference list whose primary subtag is one the app speaks - `sv-SE` counts
 * as Swedish - and English when none is.
 */
export function resolveLanguage(
  preference: LanguagePreference,
  browserLanguages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages,
): Language {
  if (preference !== 'system') {
    return preference;
  }
  for (const tag of browserLanguages) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLanguage(primary)) {
      return primary;
    }
  }
  return 'en';
}

export function applyLanguage(language: Language, root: HTMLElement = document.documentElement): void {
  root.lang = language;
}
