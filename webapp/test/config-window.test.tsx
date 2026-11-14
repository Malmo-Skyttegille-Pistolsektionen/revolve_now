// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://127.0.0.1:18097" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsProvider } from '../src/context/SettingsContext';
import { useConfigWindow } from '../src/hooks/useConfigWindow';
import { useSSE } from '../src/hooks/useSSE';
import { createFakeClock } from './mock-server/clock';
import { FakeEventSource } from './fake-event-source';
import { PROGRAM_FALT_TRANING } from './fixtures';
import { createMockServer, type MockServer } from './mock-server/server';
import type { Program } from '../src/api/types';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake. See the note in start-delay.test.tsx for what is taken.
const PORT = 18097;

const PROGRAM: Program = { ...PROGRAM_FALT_TRANING, id: 1, readonly: false };

let server: MockServer;
let queryClient: QueryClient;

function Probe(): React.ReactNode {
  // The event arrives through useSSE, which invalidates the query the hook
  // reads - so a test of the hook has to have the subscription running.
  useSSE();
  const { open, state, remainingSeconds, request } = useConfigWindow();
  return (
    <div>
      <span data-testid='open'>{String(open)}</span>
      <span data-testid='state'>{state}</span>
      <span data-testid='remaining'>{String(remainingSeconds)}</span>
      <button type='button' onClick={request}>
        ask
      </button>
    </div>
  );
}

/** `button`: a board, whose window opens only for the client that asked (D-52). */
async function device(button: boolean): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: { [PROGRAM.id]: PROGRAM }, audios: [], button },
  });
  await server.listen();
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <Probe />
      </SettingsProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
  act(() => {
    FakeEventSource.latest.open();
  });
  // `open` is false both when the window is shut and before the first fetch
  // resolves, so waiting for 'false' asserts nothing. Wait for the query.
  await waitFor(() => expect(queryClient.getQueryData(['config-window', null])).not.toBeUndefined());
}

/** What the device publishes after three presses, whatever they did. */
function publish(payload: { open: boolean; remainingSeconds: number }): void {
  let delivered = false;
  act(() => {
    delivered = FakeEventSource.latest.emit('configWindow', payload);
  });
  // Fails loudly if nothing is listening for the event name.
  expect(delivered).toBe(true);
}

/** Asks from this browser and waits for the request to be pending. */
async function ask(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'ask' }));
  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('pending'));
}

beforeEach(() => {
  localStorage.clear();
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  cleanup();
  queryClient.unmount();
  queryClient.clear();
  await server.close();
});

describe('the configuration window', () => {
  it('reports the device as shut when nobody has asked', async () => {
    await device(true);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('closed'));
    expect(screen.getByTestId('open').textContent).toBe('false');
    expect(screen.getByTestId('remaining').textContent).toBe('0');
  });

  // The whole flow (D-52): ask first, the presses last, and the event is
  // what tells this browser to look.
  it('opens for this browser once it has asked and BOOT is pressed', async () => {
    await device(true);
    await ask();
    expect(localStorage.getItem('rt_settings_config_window_token')).toMatch(/^[0-9a-f]{32}$/);

    expect(server.pressBoot()).toBe('granted');
    publish({ open: true, remainingSeconds: 300 });

    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('true'));
    expect(screen.getByTestId('remaining').textContent).toBe('300');
  });

  // #656: the window somebody else asked for is not this browser's.
  it('stays shut here when the window opened for another client', async () => {
    await device(true);
    const base = `http://127.0.0.1:${String(PORT)}/api/v2`;
    await fetch(`${base}/config-window/request`, { method: 'POST' });
    server.pressBoot();
    publish({ open: true, remainingSeconds: 300 });

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('elsewhere'));
    expect(screen.getByTestId('open').textContent).toBe('false');
  });

  it('shows a conflict when another client asked at the same time', async () => {
    await device(true);
    await ask();
    const base = `http://127.0.0.1:${String(PORT)}/api/v2`;
    await fetch(`${base}/config-window/request`, { method: 'POST' });
    expect(server.pressBoot()).toBe('conflict');
    publish({ open: false, remainingSeconds: 0 });

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('conflict'));
    expect(screen.getByTestId('open').textContent).toBe('false');
  });

  // The lapse is the transition nothing else in the system would notice, and
  // the one that leaves a stale tab if it is missed.
  it('closes when the device publishes the window lapsing', async () => {
    await device(true);
    await ask();
    server.pressBoot();
    publish({ open: true, remainingSeconds: 300 });
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('true'));

    server.closeConfigWindow();
    publish({ open: false, remainingSeconds: 0 });

    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('false'));
    expect(screen.getByTestId('remaining').textContent).toBe('0');
  });

  // Reconfiguring the machine and operating it are different activities, and
  // these values only take effect at the next restart - so the device refuses
  // during a run, and the app must not offer a form that cannot save.
  it('refuses the write while a program is running', async () => {
    await device(false);
    const base = `http://127.0.0.1:${String(PORT)}/api/v2`;

    await fetch(`${base}/programs/${String(PROGRAM.id)}/load`, { method: 'POST' });
    // The id is required in the body; without it start answers 400 and the run
    // never begins - which is how an earlier version of this test "passed".
    const started = await fetch(`${base}/programs/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: PROGRAM.id }),
    });
    expect(started.status).toBe(200);

    const state = (await (await fetch(`${base}/config/hardware`)).json()) as {
      writeWindow: { open: boolean };
    };
    expect(state.writeWindow.open).toBe(false);

    const refused = await fetch(`${base}/config/hardware`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Bana 1' }),
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { type: string }).type).toBe('/problems/program_running');
  });

  // The hole a review found: the PUT was guarded and reset was not. Reset
  // rewrites every value at once, so on a device configured for a non-stock
  // board it is the more destructive of the two - guarding only the PUT
  // protected nothing, because one click undid it.
  it('refuses reset while the window is shut, not just the write', async () => {
    await device(true);
    const base = `http://127.0.0.1:${String(PORT)}/api/v2`;

    const refused = await fetch(`${base}/config/hardware/reset`, { method: 'POST' });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { type: string }).type).toBe('/problems/hardware_config_window_closed');
  });

  it('refuses reset while a program is running', async () => {
    await device(false);
    const base = `http://127.0.0.1:${String(PORT)}/api/v2`;

    await fetch(`${base}/programs/${String(PROGRAM.id)}/load`, { method: 'POST' });
    const started = await fetch(`${base}/programs/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: PROGRAM.id }),
    });
    expect(started.status).toBe(200);

    const refused = await fetch(`${base}/config/hardware/reset`, { method: 'POST' });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { type: string }).type).toBe('/problems/program_running');
  });

  // Without a local tick the countdown would sit still between events, which
  // reads as a stopped clock rather than a window that is closing.
  it('ticks down between events', async () => {
    await device(true);
    await ask();
    server.pressBoot();
    publish({ open: true, remainingSeconds: 300 });
    await waitFor(() => expect(screen.getByTestId('remaining').textContent).toBe('300'));

    await waitFor(() => expect(Number(screen.getByTestId('remaining').textContent)).toBeLessThan(300), {
      timeout: 3000,
    });
  });
});
