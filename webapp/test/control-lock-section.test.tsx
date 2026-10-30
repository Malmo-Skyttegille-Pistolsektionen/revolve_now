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

/** A board with a BOOT button, whose window opens for one client (D-52). */
async function device(): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: {}, audios: [], button: true },
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
    await device();
    renderSection();
    await screen.findByText(/then press its BOOT button three times/);

    fireEvent.change(screen.getByTestId('control-lock-password'), { target: { value: 'competition-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn the lock on' }));

    await screen.findByText(/Could not turn the control lock on\. Ask for the configuration window first/);
    expect(screen.getByTestId('control-lock-status').textContent).toBe('OFF');
  });

  // D-52: the presses open the window for the browser that asked, then the lock goes on.
  it('turns the lock on once this browser has asked and BOOT is pressed', async () => {
    await device();
    renderSection();
    fireEvent.click(await screen.findByTestId('config-window-request'));
    await screen.findByTestId('config-window-pending');
    server.pressBoot();
    // Polled while pending, so the grant shows without an event.
    await waitFor(() => expect(screen.queryByTestId('config-window-pending')).toBeNull(), { timeout: 4000 });

    fireEvent.change(screen.getByTestId('control-lock-password'), { target: { value: 'competition-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn the lock on' }));
    await waitFor(() => expect(screen.getByTestId('control-lock-status').textContent).not.toBe('OFF'));
  });

  it('without a session, offers no way off until the window opens', async () => {
    await device();
    await enableControlLockElsewhere(PORT, 'competition-2026', () => server.pressBoot());
    server.closeConfigWindow();
    renderSection();

    await screen.findByText(/Forgotten the password\?/);
    expect(screen.queryByRole('button', { name: 'Turn the lock off' })).toBeNull();
  });

  // #656: the window the other client was given is not this browser's.
  it('offers no way off with the window open for another client', async () => {
    await device();
    await enableControlLockElsewhere(PORT, 'competition-2026', () => server.pressBoot());
    renderSection();

    await screen.findByTestId('config-window-elsewhere');
    expect(screen.queryByRole('button', { name: 'Turn the lock off' })).toBeNull();
  });

  it('without a session, turns the lock off while the window is open', async () => {
    await device();
    await enableControlLockElsewhere(PORT, 'competition-2026', () => server.pressBoot());
    renderSection();
    fireEvent.click(await screen.findByTestId('config-window-request'));
    await screen.findByTestId('config-window-pending');
    server.pressBoot();

    fireEvent.click(await screen.findByRole('button', { name: 'Turn the lock off' }, { timeout: 4000 }));

    await waitFor(() => expect(screen.getByTestId('control-lock-status').textContent).toBe('OFF'));
  });
});
