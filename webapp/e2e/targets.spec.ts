import { expect, test } from '@playwright/test';

import { openApp, openStateStream, resetDevice, SHIPPED_PROGRAM_IDS, type StateStream } from './device';

/**
 * D-31 end to end: series completion, reset and skip never move the targets.
 * The strip has to read exactly what the last event left, through the HTTP
 * handlers, the SSE publisher and the page. Stop is asserted in run.spec.ts.
 *
 * Each series ends on the opposite of how it started, so a handler that put
 * the targets back to either position would show: series 0 ends shown (the old
 * hide-at-completion would turn it), series 1 ends hidden (a return to the
 * resting position would turn it).
 */

const API = '/api/v2';

const EVENT_MS = 2000;

const DOCUMENT = {
  title: 'E2E resting state',
  description: 'e2e',
  readonly: false,
  series: [
    {
      name: 'Ends shown',
      optional: false,
      events: [
        { duration: EVENT_MS, command: 'hide' },
        { duration: EVENT_MS, command: 'show' },
      ],
    },
    {
      name: 'Ends hidden',
      optional: false,
      events: [
        { duration: EVENT_MS, command: 'show' },
        { duration: EVENT_MS, command: 'hide' },
      ],
    },
  ],
};

let stream: StateStream | undefined;

test.beforeEach(async ({ request }) => {
  await resetDevice(request);
});

// load.spec.ts asserts the program list is exactly the shipped eight, whatever
// order the specs run in. Reset first: deleting the loaded program unloads it.
test.afterEach(async ({ request }) => {
  stream?.close();
  stream = undefined;
  await resetDevice(request);
  const programs = (await (await request.get(`${API}/programs`)).json()) as { id: number; readonly: boolean }[];
  for (const program of programs) {
    if (!program.readonly && !SHIPPED_PROGRAM_IDS.includes(program.id)) {
      await request.delete(`${API}/programs/${program.id}/delete`);
    }
  }
});

test('completion, reset and skip leave the targets where the last event put them', async ({
  page,
  request,
  baseURL,
}) => {
  const upload = await request.post(`${API}/programs`, { data: DOCUMENT });
  expect(upload.status(), await upload.text()).toBe(201);
  const { id } = (await upload.json()) as { id: number };
  expect((await request.post(`${API}/programs/${id}/load`)).ok()).toBeTruthy();

  stream = await openStateStream(baseURL!);
  const state = (): ReturnType<StateStream['latest']> => stream!.latest();
  const strip = page.getByTestId('run-target-status');

  await openApp(page);
  await expect(page.getByTestId('run-program-id')).toHaveText(String(id));
  await expect(strip).toHaveText('shown');

  // --- series 0 runs to completion, ending shown ------------------------
  expect((await request.post(`${API}/programs/start`, { data: { id } })).ok()).toBeTruthy();
  // The first event really turned them, so "shown" afterwards is the second
  // event's doing and not a run that never moved anything.
  await expect(strip).toHaveText('hidden');
  await expect
    .poll(() => state()?.programState, { timeout: 4 * EVENT_MS + 10_000 })
    // Another series follows: the device selects it, paused at its first event.
    .toEqual({ running: false, currentSeriesIndex: 1, currentEventIndex: 0, tickerMs: null });
  expect(state()?.targetBanks).toEqual({ A: 'shown' });
  await expect(strip).toHaveText('shown');

  // --- series 1, the last, runs to completion, ending hidden ------------
  expect((await request.post(`${API}/programs/start`, { data: { id } })).ok()).toBeTruthy();
  await expect
    .poll(() => state()?.programState, { timeout: 4 * EVENT_MS + 10_000 })
    // The last series keeps its position: nothing follows to select.
    .toEqual({ running: false, currentSeriesIndex: 1, currentEventIndex: 1, tickerMs: null });
  expect(state()?.targetBanks).toEqual({ A: 'hidden' });
  await expect(strip).toHaveText('hidden');

  // --- reset: back to event 0, targets untouched ------------------------
  expect((await request.post(`${API}/programs/reset`)).ok()).toBeTruthy();
  await expect
    .poll(() => state()?.programState)
    .toEqual({ running: false, currentSeriesIndex: 1, currentEventIndex: 0, tickerMs: null });
  expect(state()?.targetBanks).toEqual({ A: 'hidden' });
  await expect(strip).toHaveText('hidden');

  // --- skip: another series selected, targets untouched (D-27, D-32) ----
  expect((await request.post(`${API}/programs/series/0/skip_to`, { data: { id } })).ok()).toBeTruthy();
  await expect
    .poll(() => state()?.programState)
    .toEqual({ running: false, currentSeriesIndex: 0, currentEventIndex: 0, tickerMs: null });
  expect(state()?.targetBanks).toEqual({ A: 'hidden' });
  await expect(strip).toHaveText('hidden');
});
