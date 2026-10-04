import { useSettings } from '../context/SettingsContext';
import { en } from './en';
import { type Language, resolveLanguage } from './language';
import type { Messages } from './messages';
import { sv } from './sv';

export type { Messages } from './messages';
export type { Language, LanguagePreference } from './language';

export const MESSAGES: Record<Language, Messages> = { en, sv };

/** The language the app renders in right now, with `system` resolved. */
export function useLanguage(): Language {
  const { settings } = useSettings();
  return resolveLanguage(settings.language);
}

/**
 * The dictionary for the current language. Components read it as
 * `t.settings.title`; a string with a value in it is a function, so the
 * translation decides the word order.
 */
export function useT(): Messages {
  return MESSAGES[useLanguage()];
}
