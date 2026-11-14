// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://127.0.0.1:18231" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HardwareSection } from '../src/components/HardwareSection';
import { WifiConfigSection } from '../src/components/WifiConfigSection';
import { SettingsProvider } from '../src/context/SettingsContext';
import { LANGUAGE_STORAGE_KEY } from '../src/i18n/language';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake.
const PORT = 18231;

let server: MockServer;
let queryClient: QueryClient;

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem(LANGUAGE_STORAGE_KEY, 'sv');
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  server = createMockServer({ clock: createFakeClock(), port: PORT, seed: { programs: {}, audios: [] } });
  await server.listen();
});

afterEach(async () => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
  await server.close();
});

describe('Expert mode in Swedish', () => {
  it('renders the hardware section in Swedish', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <HardwareSection />
        </SettingsProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Hårdvara' })).toBeTruthy();
    expect((await screen.findByTestId('hardware-bank-add')).textContent).toContain('Lägg till tavelgrupp B');
    expect(screen.getByTestId('hardware-save').textContent).toBe('Spara');
  });

  it('renders the WiFi section in Swedish', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <WifiConfigSection />
        </SettingsProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Eller skriv in nätverkets namn')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Visa lösenordet' })).toBeTruthy();
    expect((await screen.findByTestId('wifi-config-save')).textContent).toBe('Spara');
  });
});
