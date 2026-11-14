// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsProvider } from '../src/context/SettingsContext';
import { LANGUAGE_STORAGE_KEY } from '../src/i18n/language';
import { StandaloneEditorApp } from '../src/standalone/StandaloneEditorApp';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(LANGUAGE_STORAGE_KEY, 'sv');
});

afterEach(cleanup);

describe('StandaloneEditorApp in Swedish', () => {
  it('renders the picker in Swedish when the stored language is sv', () => {
    render(
      <SettingsProvider>
        <StandaloneEditorApp />
      </SettingsProvider>,
    );
    // The h1 also holds the logo, so its accessible name is more than the word.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Programredigerare');
    expect(screen.getByRole('heading', { name: 'Öppna från ett repo' })).toBeTruthy();
    expect(screen.getByTestId('picker-repo-browse').textContent).toBe('Bläddra bland program');
    expect(screen.getByTestId('picker-new-start').textContent).toBe('Nytt program');
  });
});
