// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useControlLockStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18101" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EthernetStatus } from '../src/api/types';
import { SettingsProvider } from '../src/context/SettingsContext';
import { EthernetSection } from '../src/components/EthernetSection';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake. Pick the next free number for a new suite.
const PORT = 18101;

let server: MockServer;
let queryClient: QueryClient;

async function device(ethernet?: Partial<EthernetStatus>): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: {}, audios: [], ethernet },
  });
  await server.listen();
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <EthernetSection />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
  await server.close();
});

describe('the Ethernet block on Settings', () => {
  it('shows the link and the address of a W5500 that answered', async () => {
    await device({
      present: true,
      linkUp: true,
      speedMbps: 100,
      fullDuplex: true,
      ipAddress: '192.168.1.50',
      macAddress: '30:ed:a0:a8:ab:7b',
    });
    renderSection();

    expect((await screen.findByTestId('ethernet-link')).textContent).toContain('100 Mbit/s');
    expect(screen.getByTestId('ethernet-ip').textContent).toBe('192.168.1.50');
    expect(screen.getByTestId('ethernet-mac').textContent).toBe('30:ed:a0:a8:ab:7b');
  });

  it('says so when the cable is out', async () => {
    await device({ present: true, macAddress: '30:ed:a0:a8:ab:7b' });
    renderSection();

    expect((await screen.findByTestId('ethernet-link')).textContent).toContain('No cable');
    expect(screen.getByTestId('ethernet-ip').textContent).toBe('none yet');
  });

  // Most boards have no W5500; a section saying so on every one is noise.
  it('stays out of the way on a board without one', async () => {
    await device();
    renderSection();

    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.queryByTestId('ethernet-section')).toBeNull();
  });
});
