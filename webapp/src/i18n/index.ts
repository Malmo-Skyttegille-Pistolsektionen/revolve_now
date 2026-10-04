import { use } from 'react';
import { SettingsContext } from '../context/SettingsContext';
import { en } from './en';
import { type Language, resolveLanguage, useBrowserLanguages } from './language';
import type { Messages } from './messages';
import { sv } from './sv';

export type { Messages } from './messages';

const MESSAGES: Record<Language, Messages> = { en, sv };

/**
 * The language the app renders in right now, with `system` resolved. Outside
 * a `SettingsProvider` - a component rendered on its own in a test - it is
 * the browser's, which is what the provider would have started from.
 */
function useLanguage(): Language {
  const settings = use(SettingsContext);
  return resolveLanguage(settings?.settings.language ?? 'system', useBrowserLanguages());
}

/**
 * The dictionary for the current language. Components read it as
 * `t.settings.title`; a string with a value in it is a function, so the
 * translation decides the word order.
 */
export function useT(): Messages {
  return MESSAGES[useLanguage()];
}
