/**
 * The colour theme preference (#334). `system` follows `prefers-color-scheme`;
 * the other two pin it. Applied as `data-theme` on `<html>`, which
 * `src/theme.css` reads - an unset attribute is what lets the OS decide.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const DEFAULT_THEME: ThemePreference = 'system';

export const THEME_STORAGE_KEY = 'rt_settings_theme';

export function parseTheme(value: string | null): ThemePreference {
  return THEME_PREFERENCES.find((theme) => theme === value) ?? DEFAULT_THEME;
}

export function readStoredTheme(): ThemePreference {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: ThemePreference, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}
