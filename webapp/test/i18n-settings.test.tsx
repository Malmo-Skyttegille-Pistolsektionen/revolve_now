// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { StorageSection } from '../src/components/StorageSection';
import { SettingsProvider } from '../src/context/SettingsContext';
import { LANGUAGE_STORAGE_KEY } from '../src/i18n/language';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(LANGUAGE_STORAGE_KEY, 'sv');
});

afterEach(cleanup);

describe('settings and common strings in Swedish', () => {
  it('renders a Settings section with the Swedish heading', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <StorageSection />
        </SettingsProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Lagring' })).toBeTruthy();
    expect(screen.getByText('Kontrollerar…')).toBeTruthy();
  });

  it('renders the shared Cancel button in Swedish', () => {
    render(
      <SettingsProvider>
        <ConfirmDialog title='Ta bort?' body={<p />} confirmLabel='Ta bort' onConfirm={() => {}} onCancel={() => {}} />
      </SettingsProvider>,
    );
    expect(screen.getByText('Avbryt')).toBeTruthy();
  });
});
