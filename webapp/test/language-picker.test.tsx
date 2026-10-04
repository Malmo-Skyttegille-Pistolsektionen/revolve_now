// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LanguageSection } from '../src/components/LanguageSection';
import { SettingsProvider } from '../src/context/SettingsContext';
import { LANGUAGE_STORAGE_KEY, resolveLanguage } from '../src/i18n/language';

function renderSection(): void {
  render(
    <SettingsProvider>
      <LanguageSection />
    </SettingsProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
});

afterEach(cleanup);

describe('LanguageSection', () => {
  it('defaults to System, which leaves the choice to the browser', () => {
    renderSection();
    expect((screen.getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('heading', { name: 'Language' })).toBeTruthy();
  });

  it('switches the page to Swedish and keeps the choice in this browser', () => {
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: 'Svenska' }));
    expect(screen.getByRole('heading', { name: 'Språk' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('sv');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('sv');

    // A language is named in itself, whatever the page is in.
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(screen.getByRole('heading', { name: 'Language' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });

  it('restores a stored choice', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'sv');
    renderSection();
    expect((screen.getByRole('radio', { name: 'Svenska' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('heading', { name: 'Språk' })).toBeTruthy();
  });
});

describe('resolveLanguage', () => {
  it('reads the browser list for System and ignores the region', () => {
    expect(resolveLanguage('system', ['sv-SE', 'en-US'])).toBe('sv');
    expect(resolveLanguage('system', ['da-DK', 'sv'])).toBe('sv');
  });

  it('falls back to English when the browser speaks nothing the app does', () => {
    expect(resolveLanguage('system', ['da-DK', 'de'])).toBe('en');
    expect(resolveLanguage('system', [])).toBe('en');
  });

  it('pins a chosen language regardless of the browser', () => {
    expect(resolveLanguage('en', ['sv-SE'])).toBe('en');
    expect(resolveLanguage('sv', ['en-US'])).toBe('sv');
  });
});
