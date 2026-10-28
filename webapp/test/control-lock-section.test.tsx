// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useControlLockStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18120" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsProvider } from '../src/context/SettingsContext';
import { ControlLockSection } from '../src/components/ControlLockSection';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';
import { enableControlLockElsewhere } from './other-client';

// Distinct per suite - vitest runs files in parallel.
const PORT = 18120;

let server: MockServer;
let queryClient: QueryClient;

async function device(configWindowOpen: boolean): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: {}, audios: [], configWindowOpen },
  });
  await server.listen();
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <ControlLockSection />
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
  queryClient.clear();
  await server.close();
});

// D-51: the lock outlives a restart, so the page says what turning it on takes,
// and how somebody at the board gets back in.
describe('the control lock section', () => {
  it('says the BOOT button comes first, and shows the refusal when it did not', async () => {
    await device(false);
    renderSection();
    await screen.findByText(/press its BOOT button three times/);

    fireEvent.change(screen.getByTestId('control-lock-password'), { target: { value: 'competition-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn the lock on' }));

    await screen.findByText(/Could not turn the control lock on\. Press the BOOT button/);
    expect(screen.getByTestId('control-lock-status').textContent).toBe('OFF');
  });

  it('without a session, offers no way off until the window opens', async () => {
    await device(true);
    await enableControlLockElsewhere(PORT, 'competition-2026');
    server.setConfigWindow(false);
    renderSection();

    await screen.findByText(/Forgotten the password\?/);
    expect(screen.queryByRole('button', { name: 'Turn the lock off' })).toBeNull();
  });

  it('without a session, turns the lock off while the window is open', async () => {
    await device(true);
    await enableControlLockElsewhere(PORT, 'competition-2026');
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Turn the lock off' }));

    await waitFor(() => expect(screen.getByTestId('control-lock-status').textContent).toBe('OFF'));
  });
});
