// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://127.0.0.1:18122" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Program } from '../src/api/types';
import { SettingsProvider } from '../src/context/SettingsContext';
import { LANGUAGE_STORAGE_KEY } from '../src/i18n/language';
import { ProgramsView } from '../src/routes/programs';
import { PROGRAM_FALT_TRANING } from './fixtures';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';

// Distinct per suite, see programs.test.tsx; the i18n suites sit at +40.
const PORT = 18122;

const SHIPPED: Program = { ...PROGRAM_FALT_TRANING, id: 40, readonly: true };
const UPLOADED: Program = { ...PROGRAM_FALT_TRANING, id: 1040, title: 'Klubbserie', readonly: false };

let server: MockServer;
let queryClient: QueryClient;

beforeAll(async () => {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: { [SHIPPED.id]: SHIPPED, [UPLOADED.id]: UPLOADED }, audios: [] },
  });
  await server.listen();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  server.reset();
  localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
});

describe('the programs page in Swedish', () => {
  it('renders the list from the sv dictionary', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'sv');
    render(
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <ProgramsView />
        </SettingsProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Program' })).toBeTruthy();
    await screen.findByTestId('programs-table');
    await waitFor(() => expect(screen.getByTestId(`program-row-${UPLOADED.id}`)).toBeTruthy());

    expect(screen.getByText('Medföljande')).toBeTruthy();
    expect(screen.getByText('Uppladdat')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nytt program' })).toBeTruthy();
  });
});
