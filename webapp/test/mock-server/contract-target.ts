/**
 * The device `contract.test.ts` talks to: the in-process mock by default, or
 * the firmware at `CONTRACT_BASE_URL` (an origin, e.g. `http://127.0.0.1:8080`).
 * `webapp-e2e.yml` sets it to the QEMU instance the Playwright suite just used,
 * so one set of assertions holds both to the same contract (#452).
 *
 * A real device keeps its state between tests, so each test starts and ends
 * the way `resetDevice` in `e2e/device.ts` leaves it, and anything a test
 * uploads is deleted afterwards. Point it at the emulator, not a range board:
 * the suite turns the control lock on and off with the e2e password.
 */
import { afterEach, beforeEach, expect } from 'vitest';

import type { StateUpdatePayload } from '../../src/api/types';
import { CONTROL_LOCK_PASSWORD, SHIPPED_PROGRAM_IDS } from '../../e2e/device-constants';
import { createFakeClock } from './clock';
import { createMockServer, type MockSeed, type MockServer } from './server';
import { flushIO, openSSE, type SSEReader } from './sse-reader';

const deviceOrigin = process.env.CONTRACT_BASE_URL?.replace(/\/$/, '') || undefined;

export const onDevice = deviceOrigin !== undefined;

/** The password every shared test locks with, so the reset can always log back in. */
export const LOCK_PASSWORD = CONTROL_LOCK_PASSWORD;

/** The ids `GET /programs` lists on each target: the shipped image, or the mock's seed. */
export function expectedProgramIds(seed: MockSeed): number[] {
  return onDevice
    ? SHIPPED_PROGRAM_IDS
    : Object.keys(seed.programs)
        .map(Number)
        .sort((a, b) => a - b);
}

let origin = '';
let server: MockServer | null = null;
let streams: SSEReader[] = [];

/** `/api/v2` on the current target. */
export function apiBase(): string {
  return `${origin}/api/v2`;
}

/**
 * `fetch`, with the body read before it returns. A response nobody consumes
 * holds its connection open, and the firmware has a dozen sockets in all.
 */
export async function api(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${apiBase()}${path}`, init);
  const body = await res.arrayBuffer();
  const nullBody = [101, 204, 205, 304].includes(res.status);
  return new Response(nullBody ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/**
 * The event stream, once the full state the device sends on connect has
 * arrived - so a count taken straight after is not racing the first frame.
 * Closed by the teardown if the test does not close it.
 */
export async function stream(): Promise<SSEReader> {
  const reader = await openSSE(origin);
  streams.push(reader);
  await expect
    .poll(() => reader.payloads<StateUpdatePayload>('stateUpdate').length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  return reader;
}

/**
 * Let a published frame reach the reader. The emulator is two orders of
 * magnitude slower than the mock, and a "nothing was published" assertion is
 * only as good as the wait before it.
 */
export function settle(): Promise<void> {
  return onDevice ? new Promise((resolve) => setTimeout(resolve, 750)) : flushIO();
}

/** Whatever `expect.poll` needs to outlast on this target. */
export const pollTimeout = onDevice ? 20_000 : 1_000;

/**
 * Register the per-test setup for one `describe`. On the mock: a fresh server
 * on `seed`, with a clock nothing advances. On the device: the seed is ignored
 * and the device is reset either side of the test.
 */
export function setUpTarget(seed: MockSeed): void {
  let uploaded: { programs: Set<number>; audios: Set<number> } | null = null;

  beforeEach(async () => {
    if (deviceOrigin !== undefined) {
      origin = deviceOrigin;
      await resetDevice();
      uploaded = await writableIds();
      return;
    }
    server = createMockServer({ clock: createFakeClock(1_000_000), seed });
    origin = `http://127.0.0.1:${String(await server.listen())}`;
  });

  afterEach(async () => {
    for (const reader of streams) reader.close();
    streams = [];
    if (server !== null) {
      await server.close();
      server = null;
      return;
    }
    await resetDevice();
    if (uploaded !== null) await deleteUploadsSince(uploaded);
  });
}

async function send(method: string, path: string, body?: unknown, token?: string): Promise<Response> {
  return api(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function must(res: Response, what: string): void {
  if (!res.ok) throw new Error(`contract teardown: could not ${what}: ${String(res.status)}`);
}

/** `resetDevice` in `e2e/device.ts`, over plain `fetch` - kept in step with it. */
async function resetDevice(): Promise<void> {
  const enable = await send('POST', '/control-lock/enable', { password: LOCK_PASSWORD });
  const session =
    enable.status === 409 ? await send('POST', '/control-lock/login', { password: LOCK_PASSWORD }) : enable;
  must(session, 'obtain a control lock session');
  const { token } = (await session.json()) as { token: string };

  await send('POST', '/programs/stop', undefined, token);
  await send('POST', '/programs/reset', undefined, token);
  must(await send('POST', '/programs/unload', undefined, token), 'unload');
  must(await send('POST', '/targets/show', undefined, token), 'show the targets');
  must(await send('POST', '/control-lock/disable', undefined, token), 'turn the control lock off');
}

async function writableIds(): Promise<{ programs: Set<number>; audios: Set<number> }> {
  const programs = (await (await api('/programs')).json()) as { id: number; readonly: boolean }[];
  const { audios } = (await (await api('/audios')).json()) as { audios: { id: number; readonly: boolean }[] };
  return {
    programs: new Set(programs.filter((p) => !p.readonly).map((p) => p.id)),
    audios: new Set(audios.filter((a) => !a.readonly).map((a) => a.id)),
  };
}

/** Delete what the test uploaded, and nothing that was there before it. */
async function deleteUploadsSince(before: { programs: Set<number>; audios: Set<number> }): Promise<void> {
  const now = await writableIds();
  for (const id of now.programs) {
    if (!before.programs.has(id))
      must(await send('DELETE', `/programs/${String(id)}/delete`), `delete program ${String(id)}`);
  }
  for (const id of now.audios) {
    if (!before.audios.has(id))
      must(await send('DELETE', `/audios/${String(id)}/delete`), `delete audio ${String(id)}`);
  }
}
