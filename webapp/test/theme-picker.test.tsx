// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemePicker } from '../src/components/ThemePicker';
import { SettingsProvider } from '../src/context/SettingsContext';
import { THEME_STORAGE_KEY, applyTheme, readStoredTheme } from '../src/lib/theme';

function renderPicker(): void {
  render(
    <SettingsProvider>
      <ThemePicker />
    </SettingsProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(cleanup);

describe('ThemePicker', () => {
  it('defaults to System, which leaves the choice to the OS', () => {
    renderPicker();
    expect((screen.getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('pins the theme and keeps the choice in this browser', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('restores a stored choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderPicker();
    expect((screen.getByRole('radio', { name: 'Light' }) as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('readStoredTheme', () => {
  // A value from a future build, or a hand-edited one, must not leave the page
  // with no theme at all.
  it('falls back to System for an unknown value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readStoredTheme()).toBe('system');
  });

  it('is what the entry points apply before the first render', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    applyTheme(readStoredTheme());
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
