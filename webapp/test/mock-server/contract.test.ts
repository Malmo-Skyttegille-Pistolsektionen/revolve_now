/**
 * The REST and SSE contract, asserted against whichever device
 * `contract-target.ts` points at: the in-process mock by default, the QEMU
 * firmware when `CONTRACT_BASE_URL` is set (#452). A case belongs here only if
 * it holds on both without a fake clock or a seed only the mock can take;
 * the rest live in `mock-server.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AudioFile, DiagnosticsInfo, LibraryChangedPayload, StateUpdatePayload } from '../../src/api/types';
import shipped40 from '../../../resources/programs/files/40.json';
import { PROGRAM_FALT_TRANING } from '../fixtures';
import {
  api,
  expectedProgramIds,
  LOCK_PASSWORD,
  onDevice,
  pollTimeout,
  settle,
  stream,
  setUpTarget,
} from './contract-target';
import { HARDWARE_DEFAULTS, type MockSeed } from './server';

if (onDevice) vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** The app's tsconfig targets ES2020, so no `Array.prototype.at`. */
function last<T>(items: T[]): T {
  return items[items.length - 1];
}

/**
 * Seeded to look like the shipped image where a case depends on it: program
 * 40, and clip 3 shipped (read-only) as it is on the device.
 */
const SEED: MockSeed = {
  programs: { 40: PROGRAM_FALT_TRANING },
  audios: [
    { id: 3, title: 'Eld upphör', filename: '/embedded/audio/3.wav', readonly: true },
    { id: 1000, title: 'Klubbmästerskap', filename: '/userdata/audio/1000.wav', readonly: false },
  ] satisfies AudioFile[],
};

/** Program 40 is the fixture on the mock and the shipped file on the device. */
const PROGRAM_40_SERIES = (onDevice ? shipped40 : PROGRAM_FALT_TRANING).series.length;

/** `POST /programs/start` for a named program - the body is required (D-27). */
async function start(id: number, init?: RequestInit): Promise<Response> {
  return api('/programs/start', { method: 'POST', body: JSON.stringify({ id }), ...init });
}

/**
 * `POST /programs/series/{index}/skip_to` for a named program - the body is
 * required, same shape as `start` (D-27, #105).
 */
async function skipTo(index: number, id: number, init?: RequestInit): Promise<Response> {
  return api(`/programs/series/${String(index)}/skip_to`, {
    method: 'POST',
    body: JSON.stringify({ id }),
    ...init,
  });
}

async function enableLock(): Promise<string> {
  const res = await api('/control-lock/enable', { method: 'POST', body: JSON.stringify({ password: LOCK_PASSWORD }) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

/**
 * Asserts the whole RFC 9457 problem document, media type included (D-19).
 *
 * The whole document rather than just the `type`: `title` and `status` are
 * fixed per type by the firmware and must not vary between occurrences, and
 * `detail` is what a user is shown.
 */
async function expectProblem(
  res: Response,
  expected: { type: string; title: string; status: number; detail: string },
): Promise<void> {
  expect(res.status).toBe(expected.status);
  expect(res.headers.get('content-type')).toBe('application/problem+json');
  expect(await res.json()).toEqual(expected);
}

describe('REST surface', () => {
  setUpTarget(SEED);

  it('lists programs as summaries, without the series payload', async () => {
    const res = await api('/programs');
    expect(res.status).toBe(200);
    const list = (await res.json()) as Record<string, unknown>[];
    expect(list.map((program) => program.id as number).sort((a, b) => a - b)).toEqual(expectedProgramIds(SEED));
    expect(list.find((program) => program.id === 40)).toEqual({
      id: 40,
      title: 'Fältträning',
      description: expect.any(String),
      banksRequired: 1,
      readonly: true,
    });
    for (const program of list) expect(program).not.toHaveProperty('series');
  });

  it('serves the full program by id and 404s an unknown one', async () => {
    const program = await (await api('/programs/40')).json();
    expect(program.series).toHaveLength(PROGRAM_40_SERIES);
    expect((await api('/programs/999')).status).toBe(404);
  });

  it('rejects a start with no program loaded', async () => {
    await expectProblem(await start(40), {
      type: '/problems/no_program_loaded',
      title: 'No program loaded',
      status: 400,
      detail: 'No program loaded',
    });
  });

  // --- D-27: a start names the program it is for ---------------------------

  it('rejects a start with no body, a non-object body or a non-integer id', async () => {
    await api('/programs/40/load', { method: 'POST' });
    const malformed = 'Expected a JSON body naming the program to start: {"id": <id>}';

    for (const body of [undefined, '', 'not json', '[]', '{}', '{"id":null}', '{"id":"40"}', '{"id":40.5}']) {
      const res = await api('/programs/start', { method: 'POST', body });
      expect(res.status, `body: ${String(body)}`).toBe(400);
      expect(await res.json()).toMatchObject({
        type: '/problems/start_id_required',
        status: 400,
        detail: malformed,
      });
    }
  });

  it('refuses a start for a program the device no longer holds, naming both', async () => {
    await api('/programs/40/load', { method: 'POST' });

    const res = await start(1);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      type: '/problems/start_program_mismatch',
      status: 409,
      detail: 'Start refused: the device has program 40 loaded, not program 1',
    });
  });

  it('leaves the run untouched when it refuses, and the right id still starts', async () => {
    await api('/programs/40/load', { method: 'POST' });
    const sse = await stream();
    const before = sse.payloads<StateUpdatePayload>('stateUpdate').length;

    expect((await start(1)).status).toBe(409);
    await settle();
    // A refused start publishes nothing: nothing about the device changed.
    expect(sse.payloads<StateUpdatePayload>('stateUpdate')).toHaveLength(before);
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState?.running).toBe(false);

    expect((await start(40)).status).toBe(200);
    await settle();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState?.running).toBe(true);
  });

  it('refuses a stale start even while a run is in progress', async () => {
    await api('/programs/40/load', { method: 'POST' });
    expect((await start(40)).status).toBe(200);

    // Never "fine, it is running": the caller asked for a different program.
    expect((await start(1)).status).toBe(409);
  });

  it('answers 400 rather than 409 when nothing is loaded at all', async () => {
    // The more precise diagnosis wins: the client has to load something, not
    // re-read what is loaded.
    expect((await start(1)).status).toBe(400);
  });

  it('bounds-checks skip_to', async () => {
    await api('/programs/40/load', { method: 'POST' });
    expect((await skipTo(1, 40)).status).toBe(200);
    expect((await skipTo(99, 40)).status).toBe(400);
  });

  // --- #105: a skip names the program the index is for, mirroring D-27 -----

  it('rejects a skip_to with no body, a non-object body or a non-integer id', async () => {
    await api('/programs/40/load', { method: 'POST' });
    const malformed = 'Expected a JSON body naming the program to skip: {"id": <id>}';

    for (const body of [undefined, '', 'not json', '[]', '{}', '{"id":null}', '{"id":"40"}', '{"id":40.5}']) {
      const res = await api('/programs/series/1/skip_to', { method: 'POST', body });
      expect(res.status, `body: ${String(body)}`).toBe(400);
      expect(await res.json()).toMatchObject({
        type: '/problems/skip_id_required',
        status: 400,
        detail: malformed,
      });
    }
  });

  it('refuses a skip for a program the device no longer holds, naming both', async () => {
    await api('/programs/40/load', { method: 'POST' });

    const res = await skipTo(1, 1);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      type: '/problems/skip_program_mismatch',
      status: 409,
      detail: 'Skip refused: the device has program 40 loaded, not program 1',
    });
  });

  it('leaves the selection untouched when a skip refuses, and the right id still skips', async () => {
    await api('/programs/40/load', { method: 'POST' });
    const sse = await stream();
    const before = sse.payloads<StateUpdatePayload>('stateUpdate').length;

    expect((await skipTo(1, 1)).status).toBe(409);
    await settle();
    // A refused skip publishes nothing: nothing about the device changed.
    expect(sse.payloads<StateUpdatePayload>('stateUpdate')).toHaveLength(before);
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState?.currentSeriesIndex).toBe(0);

    expect((await skipTo(1, 40)).status).toBe(200);
    await settle();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState?.currentSeriesIndex).toBe(1);
  });

  it('answers a skip 400 rather than 409 when nothing is loaded at all', async () => {
    // The more precise diagnosis wins, same precedence as start's.
    expect((await skipTo(0, 1)).status).toBe(400);
  });

  it('refuses a mismatched skip ahead of an out-of-bounds index', async () => {
    await api('/programs/40/load', { method: 'POST' });

    // The id check runs before the bounds check, so a wrong program and an
    // out-of-range index both being true still answers the mismatch.
    const res = await skipTo(99, 1);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ type: '/problems/skip_program_mismatch' });
  });

  it('gates writes on a token once the control lock is on', async () => {
    const token = await enableLock();

    expect((await api('/control-lock/status')).status).toBe(200);
    expect((await api('/programs')).status).toBe(200);
    expect((await api('/programs/40/load', { method: 'POST' })).status).toBe(401);
    expect(
      (await api('/programs/40/load', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status,
    ).toBe(200);
  });
});

describe('program storage', () => {
  setUpTarget(SEED);

  /** A document with everything the device is documented to ignore or fix up. */
  const document = {
    id: 7,
    readonly: true,
    title: 'Klubbserie',
    description: 'Uploaded from a file',
    nickname: 'dropped',
    series: [
      {
        name: 'Serie 1',
        optional: true,
        colour: 'dropped',
        events: [
          { duration: 0, command: 'show', audio_ids: [26], start: true },
          { duration: 9_000_000, command: 'hide' },
        ],
      },
    ],
  };

  async function upload(body: unknown = document): Promise<Response> {
    return api('/programs', { method: 'POST', body: JSON.stringify(body) });
  }

  it("assigns the lowest free id from 1000 up and ignores the document's", async () => {
    const res = await upload();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 1000 });

    expect(await (await upload()).json()).toEqual({ id: 1001 });
    expect(await (await upload()).json()).toEqual({ id: 1002 });

    // A freed id is handed straight back out - the firmware scans up from 1000
    // rather than counting from the highest in use.
    await api('/programs/1001/delete', { method: 'DELETE' });
    expect(await (await upload()).json()).toEqual({ id: 1001 });
  });

  it('stores what it parsed: unknown fields dropped, duration clamped, never read-only', async () => {
    const { id } = await (await upload()).json();

    expect(await (await api(`/programs/${id}`)).json()).toEqual({
      id,
      title: 'Klubbserie',
      description: 'Uploaded from a file',
      readonly: false,
      series: [
        {
          name: 'Serie 1',
          optional: true,
          events: [
            { duration: 1, command: 'show', audio_ids: [26] },
            { duration: 3600000, command: 'hide' },
          ],
        },
      ],
    });
  });

  // The anchor has to survive a round trip through storage. It is the field
  // the firmware parsed but did not serialise, so a mock that drops it would
  // agree with that bug rather than with the fix.
  it('carries timer_start_index through an upload, and refuses one past the end', async () => {
    const anchored = (timer_start_index: unknown) => ({
      title: 'Anchored',
      series: [
        {
          name: 'Serie 1',
          timer_start_index,
          events: [
            { duration: 7000, command: 'hide' },
            { duration: 4000, command: 'show' },
          ],
        },
      ],
    });

    const { id } = await (await upload(anchored(1))).json();
    expect((await (await api(`/programs/${id}`)).json()).series[0].timer_start_index).toBe(1);

    // Absent stays absent rather than becoming an explicit 0.
    const { id: plain } = await (await upload(anchored(undefined))).json();
    expect((await (await api(`/programs/${plain}`)).json()).series[0]).not.toHaveProperty('timer_start_index');

    // Refused rather than clamped: 2 names an event this series does not have.
    expect((await upload(anchored(2))).status).toBe(400);
    expect((await upload(anchored(-1))).status).toBe(400);
  });

  it('rejects an upload that is not a JSON object', async () => {
    expect((await upload('[]')).status).toBe(400);
    expect((await api('/programs', { method: 'POST' })).status).toBe(400);
  });

  // `parse_command` in firmware/lib/rt_logic/program.cpp: a command it does not
  // recognise is a typo, not an instruction, and fails the whole program.
  it('refuses a command that is not show or hide, on create and on replace', async () => {
    const withCommand = (command: unknown) => ({
      ...document,
      series: [{ name: 'Serie 1', optional: false, events: [{ duration: 1000, command }] }],
    });

    for (const command of ['sideways', 'Show', 'SHOW', 'show ', 5, true, ['show']]) {
      expect((await upload(withCommand(command))).status, `command ${JSON.stringify(command)}`).toBe(400);
    }

    // Absent, null and "" all mean "leave the targets where they are".
    for (const command of [null, '']) {
      const created = await upload(withCommand(command));
      expect(created.status, `command ${JSON.stringify(command)}`).toBe(201);
      const { id } = await created.json();
      expect((await (await api(`/programs/${id}`)).json()).series[0].events[0]).toEqual({ duration: 1000 });

      const replaced = await api(`/programs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(withCommand('sideways')),
      });
      expect(replaced.status).toBe(400);
      // Not the id-mismatch error, though the body still carries the fixture's
      // id 7: `update_uploaded` parses before it compares ids.
      await expectProblem(replaced, {
        type: '/problems/program_invalid',
        title: 'Invalid program',
        status: 400,
        detail: 'Invalid program',
      });

      // And the stored program is untouched by the refused replace.
      expect((await (await api(`/programs/${id}`)).json()).series[0].events[0]).toEqual({ duration: 1000 });
    }
  });

  it('replaces through PUT and answers with the stored form', async () => {
    const { id } = await (await upload()).json();

    const res = await api(`/programs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...document, id, title: 'Klubbserie v2' }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe('Klubbserie v2');
    expect((await (await api(`/programs/${id}`)).json()).title).toBe('Klubbserie v2');
  });

  it('keeps the path id when the body declares none, and 400s a body that declares another', async () => {
    const { id } = await (await upload()).json();

    const kept = await api(`/programs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ title: 'No id here', description: '', readonly: false, series: [] }),
    });
    expect(kept.status).toBe(200);
    expect((await kept.json()).id).toBe(id);

    const mismatched = await api(`/programs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...document, id: id + 1 }),
    });
    await expectProblem(mismatched, {
      type: '/problems/program_id_mismatch',
      title: 'Program id does not match the path',
      status: 400,
      detail: 'Program id in the document does not match the path',
    });
  });

  it('refuses to replace a shipped program, and 404s an unknown one', async () => {
    const shipped = await api('/programs/40', { method: 'PUT', body: JSON.stringify(document) });
    await expectProblem(shipped, {
      type: '/problems/program_readonly',
      title: 'Program is read-only',
      status: 409,
      detail: 'Program is read-only and cannot be updated',
    });

    expect((await api('/programs/999', { method: 'PUT', body: JSON.stringify(document) })).status).toBe(404);
  });

  it('refuses to replace the loaded program until something else is loaded (D-15)', async () => {
    const { id } = await (await upload()).json();
    await api(`/programs/${id}/load`, { method: 'POST' });

    const refused = await api(`/programs/${id}`, { method: 'PUT', body: JSON.stringify({ ...document, id }) });
    await expectProblem(refused, {
      type: '/problems/program_loaded',
      title: 'Program is loaded',
      status: 409,
      detail: 'Program is loaded; unload it before updating',
    });

    // The way out is POST /programs/unload (D-22); loading something else does
    // it too, and is what this asserts because it also proves the refusal is
    // about *this* program being loaded.
    await api('/programs/40/load', { method: 'POST' });
    expect((await api(`/programs/${id}`, { method: 'PUT', body: JSON.stringify({ ...document, id }) })).status).toBe(
      200,
    );
  });

  it('deletes an uploaded program, and tells "gone" apart from "read-only" (D-23)', async () => {
    const { id } = await (await upload()).json();

    expect((await api(`/programs/${id}/delete`, { method: 'DELETE' })).status).toBe(200);
    expect((await api(`/programs/${id}`)).status).toBe(404);
    // Now it really is gone, which is the one thing 404 means.
    expect((await api(`/programs/${id}/delete`, { method: 'DELETE' })).status).toBe(404);

    // A shipped program is refused, not hidden: it exists, GET still serves it,
    // and only the write is refused - so a client can tell "refused because it
    // is shipped" from "not there" and offer upload-as-new instead of a refresh.
    const shipped = await api('/programs/40/delete', { method: 'DELETE' });
    await expectProblem(shipped, {
      type: '/problems/program_readonly',
      title: 'Program is read-only',
      status: 409,
      detail: 'Program is read-only and cannot be deleted',
    });
    expect((await api('/programs/40')).status).toBe(200);
  });

  it('unloads the loaded program when it is deleted, and says so', async () => {
    const { id } = await (await upload()).json();
    await api(`/programs/${id}/load`, { method: 'POST' });

    const sse = await stream();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).loadedProgramId).toBe(id);

    await api(`/programs/${id}/delete`, { method: 'DELETE' });
    await settle();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).loadedProgramId).toBeNull();
  });

  it('gates create, replace and delete on the control lock token', async () => {
    const { id } = await (await upload()).json();
    const token = await enableLock();
    const authorized = { Authorization: `Bearer ${token}` };

    expect((await api('/programs', { method: 'POST', body: JSON.stringify(document) })).status).toBe(401);
    expect((await api(`/programs/${id}`, { method: 'PUT', body: JSON.stringify({ ...document, id }) })).status).toBe(
      401,
    );
    expect((await api(`/programs/${id}/delete`, { method: 'DELETE' })).status).toBe(401);

    expect(
      (await api('/programs', { method: 'POST', body: JSON.stringify(document), headers: authorized })).status,
    ).toBe(201);
    expect(
      (await api(`/programs/${id}`, { method: 'PUT', body: JSON.stringify({ ...document, id }), headers: authorized }))
        .status,
    ).toBe(200);
    expect((await api(`/programs/${id}/delete`, { method: 'DELETE', headers: authorized })).status).toBe(200);
  });
});

describe('unloading (D-22)', () => {
  setUpTarget(SEED);

  async function loadFalt(): Promise<void> {
    expect((await api('/programs/40/load', { method: 'POST' })).status).toBe(200);
  }

  it('clears the selection and publishes it', async () => {
    await loadFalt();
    const sse = await stream();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).loadedProgramId).toBe(40);

    const res = await api('/programs/unload', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Program unloaded' });

    await settle();
    const published = last(sse.payloads<StateUpdatePayload>('stateUpdate'));
    expect(published.loadedProgramId).toBeNull();
    expect(published.programState).toBeNull();
  });

  it('leaves the targets where the run left them - unloading moves no hardware', async () => {
    await loadFalt();
    await api('/targets/show', { method: 'POST' });

    await api('/programs/unload', { method: 'POST' });
    const sse = await stream();
    expect(sse.payloads<StateUpdatePayload>('stateUpdate')[0].targetBanks).toEqual({ A: 'shown' });
  });

  it('answers 200 and publishes nothing when nothing is loaded', async () => {
    const sse = await stream();
    // The connect frame, and nothing after it.
    const before = sse.payloads<StateUpdatePayload>('stateUpdate').length;

    const res = await api('/programs/unload', { method: 'POST' });
    expect(res.status).toBe(200);
    // The same message either way: a 200 says "nothing is loaded now", not
    // "something was unloaded just now". That is what makes a retry safe.
    expect(await res.json()).toEqual({ message: 'Program unloaded' });

    await settle();
    // A repeat frame would teach clients that a stateUpdate need not mean a
    // state update.
    expect(sse.payloads<StateUpdatePayload>('stateUpdate')).toHaveLength(before);
  });

  it('refuses a run in progress, and the refusal lifts with a stop', async () => {
    await loadFalt();
    await start(40);

    const refused = await api('/programs/unload', { method: 'POST' });
    await expectProblem(refused, {
      type: '/problems/program_running',
      title: 'A program is running',
      status: 409,
      detail: 'A program is running - stop it before unloading',
    });
    // Nothing happened to the run.
    const sse = await stream();
    expect(sse.payloads<StateUpdatePayload>('stateUpdate')[0].programState?.running).toBe(true);
    sse.close();

    await api('/programs/stop', { method: 'POST' });
    expect((await api('/programs/unload', { method: 'POST' })).status).toBe(200);
  });

  it('is gated on the control lock token like every other mutation', async () => {
    const token = await enableLock();

    expect((await api('/programs/unload', { method: 'POST' })).status).toBe(401);
    expect(
      (await api('/programs/unload', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status,
    ).toBe(200);
  });
});

describe('libraryChanged (D-24)', () => {
  setUpTarget(SEED);

  const document = {
    title: 'Klubbserie',
    description: 'Uploaded from a file',
    series: [{ name: 'Serie 1', optional: false, events: [{ duration: 1000, command: 'show' }] }],
  };

  it('names the program library on create, replace and delete', async () => {
    const sse = await stream();
    const kinds = (): string[] => sse.payloads<LibraryChangedPayload>('libraryChanged').map((p) => p.kind);

    const { id } = await (await api('/programs', { method: 'POST', body: JSON.stringify(document) })).json();
    await settle();
    expect(kinds()).toEqual(['program']);

    await api(`/programs/${id}`, { method: 'PUT', body: JSON.stringify(document) });
    await settle();
    expect(kinds()).toEqual(['program', 'program']);

    await api(`/programs/${id}/delete`, { method: 'DELETE' });
    await settle();
    expect(kinds()).toEqual(['program', 'program', 'program']);
  });

  it('says nothing about the library when the device only changes what it is doing', async () => {
    const sse = await stream();

    await api('/programs/40/load', { method: 'POST' });
    await api('/programs/start', { method: 'POST', body: JSON.stringify({ id: 40 }) });
    await api('/programs/stop', { method: 'POST' });
    await api('/programs/reset', { method: 'POST' });
    await api('/programs/series/1/skip_to', { method: 'POST', body: JSON.stringify({ id: 40 }) });
    await api('/programs/unload', { method: 'POST' });
    await api('/targets/toggle', { method: 'POST' });
    await settle();

    expect(sse.payloads<LibraryChangedPayload>('libraryChanged')).toEqual([]);
    // ...and every one of those did publish run state, so the stream is alive.
    expect(sse.payloads<StateUpdatePayload>('stateUpdate').length).toBeGreaterThan(1);
  });

  it('emits both events when the loaded program is deleted, for its two reasons', async () => {
    const sse = await stream();
    const { id } = await (await api('/programs', { method: 'POST', body: JSON.stringify(document) })).json();
    await api(`/programs/${id}/load`, { method: 'POST' });
    await settle();
    const stateFrames = sse.payloads<StateUpdatePayload>('stateUpdate').length;

    await api(`/programs/${id}/delete`, { method: 'DELETE' });
    await settle();

    expect(sse.payloads<StateUpdatePayload>('stateUpdate').length).toBe(stateFrames + 1);
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).loadedProgramId).toBeNull();
    // The create emitted one too, so the delete is the second.
    expect(sse.payloads<LibraryChangedPayload>('libraryChanged').map((p) => p.kind)).toEqual(['program', 'program']);
  });

  it('stays silent on a refused write - a 409 changed nothing', async () => {
    const sse = await stream();
    expect((await api('/programs/40/delete', { method: 'DELETE' })).status).toBe(409);
    expect((await api('/audios/3/delete', { method: 'DELETE' })).status).toBe(409);
    await settle();
    expect(sse.payloads<LibraryChangedPayload>('libraryChanged')).toEqual([]);
  });

  it('refuses a shipped clip with 409, ahead of every other reason (D-23)', async () => {
    const refused = await api('/audios/3/delete', { method: 'DELETE' });
    await expectProblem(refused, {
      type: '/problems/audio_readonly',
      title: 'Audio is read-only',
      status: 409,
      detail: 'Audio is read-only and cannot be deleted',
    });
    // Still there, and still listed - it was refused, not hidden.
    const { audios } = (await (await api('/audios')).json()) as { audios: AudioFile[] };
    expect(audios.map((clip) => clip.id)).toContain(3);

    // 404 is left meaning exactly one thing.
    expect((await api('/audios/999/delete', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('diagnostics (D-25)', () => {
  setUpTarget(SEED);

  const info = async (): Promise<DiagnosticsInfo> => (await (await api('/diagnostics/info')).json()) as DiagnosticsInfo;

  it('serves no startup issues for a clean boot, and counts what it holds', async () => {
    const programs = (await (await api('/programs')).json()) as unknown[];
    const served = await info();
    expect(served.startupIssues).toEqual([]);
    expect(served.programCount).toBe(programs.length);
  });

  it('counts the open event streams', async () => {
    // Relative: a real device may still be serving a stream nobody here opened.
    const before = (await info()).sseClients ?? -1;

    const sse = await stream();
    expect((await info()).sseClients).toBe(before + 1);

    sse.close();
    await expect.poll(async () => (await info()).sseClients, { timeout: pollTimeout }).toBe(before);
  });

  it('is public - no token needed once the control lock is on', async () => {
    await enableLock();
    const res = await api('/diagnostics/info');
    expect(res.status).toBe(200);
    expect(((await res.json()) as DiagnosticsInfo).controlLockEnabled).toBe(true);
  });
});

describe('the event stream', () => {
  setUpTarget(SEED);

  it('sends the full state on connect', async () => {
    const sse = await stream();
    expect(sse.payloads<StateUpdatePayload>('stateUpdate')[0]).toEqual({
      loadedProgramId: null,
      programState: null,
      // The targets rest where the boot latched them - `targetsShownAtBoot` is
      // true on a stock device (D-31), not "hidden".
      targetBanks: { A: 'shown' },
    });
  });
});

/** Hardware configuration (#144): the parts that do not need the button window. */
describe('hardware configuration', () => {
  setUpTarget(SEED);

  async function read(): Promise<Record<string, never>> {
    return (await (await api('/config/hardware')).json()) as Record<string, never>;
  }

  it('starts on the compiled defaults, with nothing overridden', async () => {
    expect(await read()).toMatchObject({
      active: HARDWARE_DEFAULTS,
      saved: HARDWARE_DEFAULTS,
      defaults: HARDWARE_DEFAULTS,
      overridden: false,
      restartRequired: false,
    });
  });

  it('gates writes on the control lock token, but not the read', async () => {
    await enableLock();

    expect((await api('/config/hardware')).status).toBe(200);
    expect(
      (
        await api('/config/hardware', {
          method: 'PUT',
          body: JSON.stringify({ banks: [{ gpio: 7, activeLow: true, name: '' }] }),
        })
      ).status,
    ).toBe(401);
    expect((await api('/config/hardware/reset', { method: 'POST' })).status).toBe(401);
  });
});

/**
 * Where the targets rest at boot changes only from the serial console (D-31,
 * #144). The firmware checks this ahead of the configuration window, so it
 * holds on a device whose window is shut.
 */
describe('the boot target state is serial-only', () => {
  setUpTarget(SEED);

  it('is reported, so a client can show it', async () => {
    const state = (await (await api('/config/hardware')).json()) as { active: { targetsShownAtBoot: boolean } };
    expect(state.active.targetsShownAtBoot).toBe(true);
  });

  // Refused rather than ignored: a change an operator believes they made is
  // worse than one they were told they could not.
  it('is refused by PUT, whatever its value, and changes nothing', async () => {
    for (const targetsShownAtBoot of [true, false]) {
      const refused = await api('/config/hardware', {
        method: 'PUT',
        body: JSON.stringify({ targetsShownAtBoot }),
      });
      await expectProblem(refused, {
        type: '/problems/hardware_config_serial_only',
        title: 'That setting changes only from the serial console',
        status: 400,
        detail:
          "targetsShownAtBoot changes only from the serial console: 'boot-targets shown' or 'boot-targets hidden'",
      });
    }

    const state = (await (await api('/config/hardware')).json()) as { overridden: boolean };
    expect(state.overridden).toBe(false);
  });

  // Even alongside fields that would otherwise be accepted: the whole request
  // is refused, so nothing is half-applied.
  it('takes the rest of the request down with it', async () => {
    const refused = await api('/config/hardware', {
      method: 'PUT',
      body: JSON.stringify({ banks: [{ gpio: 7, activeLow: true, name: '' }], targetsShownAtBoot: false }),
    });
    expect(refused.status).toBe(400);

    const state = (await (await api('/config/hardware')).json()) as { saved: { banks: { gpio: number }[] } };
    expect(state.saved.banks).toEqual(HARDWARE_DEFAULTS.banks);
  });
});

/**
 * The Ethernet build (CONFIG_RT_NET_OPENETH, QEMU) has no radio, which is the
 * build `CONTRACT_BASE_URL` points at - so the mock is seeded as one too. The
 * GET still answers - a client can tell "no radio" from "firmware older than
 * this endpoint", which an absent route cannot say - and the rest refuse.
 */
describe('WiFi on a build with no radio (#263)', () => {
  setUpTarget({
    ...SEED,
    wifi: { radioPresent: false, connected: false, ssid: '', rssi: 0, bars: 0, macAddress: '' },
  });

  it('answers the read and refuses the rest', async () => {
    const status = (await (await api('/wifi')).json()) as Record<string, unknown>;
    expect(status.radioPresent).toBe(false);
    expect(Object.keys(status)).not.toContain('password');

    for (const request of [
      api('/wifi/networks'),
      api('/wifi', { method: 'PUT', body: JSON.stringify({ ssid: 'Anything' }) }),
    ]) {
      await expectProblem(await request, {
        type: '/problems/wifi_unavailable',
        title: 'This device has no WiFi radio',
        status: 409,
        detail: 'This firmware is built for wired Ethernet and has no WiFi radio',
      });
    }
  });
});

/**
 * `POST /ota` refusals that no image could get past (#344). Anything built
 * with `fakeFirmwareImage` stays with the mock: a fake the device mistook for
 * a real image would be written and booted.
 */
describe('firmware upload refusals', () => {
  setUpTarget(SEED);

  const upload = async (image: Buffer): Promise<Response> => {
    const body = new FormData();
    body.append('file', new Blob([new Uint8Array(image)]), 'revolve_now.bin');
    return api('/ota', { method: 'POST', body });
  };

  it('refuses something that is not an image at all on its first byte', async () => {
    await expectProblem(await upload(Buffer.from('not firmware')), {
      type: '/problems/ota_image_refused',
      title: 'Firmware image refused',
      status: 400,
      detail: 'That file is not a firmware image, or it is incomplete - upload refused',
    });
  });

  it('refuses an image with no app description as a foreign one, whatever its size', async () => {
    const image = Buffer.alloc(16);
    image[0] = 0xe9;
    const res = await upload(image);
    expect(((await res.json()) as { detail: string }).detail).toBe(
      'That firmware is for a different device - upload refused',
    );
  });
});

/** Target banks (#207, D-41) on the one-bank device both targets are. */
describe('target banks', () => {
  setUpTarget(SEED);

  // A one-bank device sends `targetBanks` too, with the single key `A` (D-41),
  // so a client reads the bank count off the key count.
  it('publishes a single letter on a one-bank device', async () => {
    const sse = await stream();
    await api('/targets/show', { method: 'POST' });
    await settle();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).targetBanks).toEqual({ A: 'shown' });
  });

  it('hide actually hides', async () => {
    await api('/targets/show', { method: 'POST' });
    const res = await api('/targets/hide', { method: 'POST' });

    expect(await res.json()).toEqual({ message: 'Targets hidden' });
    // `activeLow` is true here, so hidden is the *high* pad level: the field is
    // the raw read-back, not what it means.
    const info = (await (await api('/diagnostics/info')).json()) as DiagnosticsInfo;
    expect(info.banks[0].padLevel).toBe(1);
  });

  it('refuses a banks that is not an array of letters', async () => {
    for (const body of [{ banks: 'B' }, { banks: 3 }, { banks: { B: true } }]) {
      await expectProblem(await api('/targets/show', { method: 'POST', body: JSON.stringify(body) }), {
        type: '/problems/bank_unavailable',
        title: 'No such target bank',
        status: 400,
        detail: '\'banks\' must be an array of bank letters, like ["A", "B"].',
      });
    }
  });

  // One spelling per bank, and one letter per entry: the device never has to
  // decide whether "a" and "A" are the same request.
  it('refuses lower case and multi-character entries', async () => {
    for (const letter of ['a', 'AA', '']) {
      const res = await api('/targets/show', { method: 'POST', body: JSON.stringify({ banks: [letter] }) });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { detail: string }).detail).toBe(
        `'${letter}' is not a bank on this device, which has only bank A.`,
      );
    }
  });

  it('refuses an empty list rather than widening it to every bank', async () => {
    await expectProblem(await api('/targets/show', { method: 'POST', body: JSON.stringify({ banks: [] }) }), {
      type: '/problems/bank_unavailable',
      title: 'No such target bank',
      status: 400,
      detail: "'banks' named no bank. Omit the body to move every bank.",
    });
  });
});

describe('target banks, program side', () => {
  setUpTarget(SEED);

  const BANKED = {
    title: 'Fältträning, 4 mål',
    description: '',
    series: [
      {
        name: 'Station 1',
        optional: false,
        events: [
          { duration: 4000, command: 'hide', banks: { B: 'show' } },
          { duration: 4000, command: 'hide', banks: { D: 'show' } },
        ],
      },
    ],
  };

  async function upload(document: unknown): Promise<Response> {
    return api('/programs', { method: 'POST', body: JSON.stringify(document) });
  }

  it('stores and returns the overrides an upload carries', async () => {
    const { id } = (await (await upload(BANKED)).json()) as { id: number };
    const stored = (await (await api(`/programs/${String(id)}`)).json()) as {
      series: { events: Record<string, unknown>[] }[];
    };

    expect(stored.series[0].events[0].banks).toEqual({ B: 'show' });
  });

  it.each([
    ['a letter no device can have', { I: 'show' }],
    ['a lower-case letter', { b: 'show' }],
    ['a command typo', { B: 'shwo' }],
    ['a list instead of an object', ['B']],
  ])('refuses %s the way a command typo is refused', async (_name, banks) => {
    const res = await upload({
      ...BANKED,
      series: [{ name: 'S', optional: false, events: [{ duration: 1000, banks }] }],
    });
    await expectProblem(res, {
      type: '/problems/program_invalid',
      title: 'Invalid program',
      status: 400,
      detail: 'Invalid program',
    });
  });

  it('treats null and an empty object as no overrides at all', async () => {
    const { id } = (await (
      await upload({
        ...BANKED,
        series: [
          {
            name: 'S',
            optional: false,
            events: [
              { duration: 1000, banks: null },
              { duration: 1000, banks: {} },
            ],
          },
        ],
      })
    ).json()) as { id: number };

    const stored = (await (await api(`/programs/${String(id)}`)).json()) as {
      series: { events: Record<string, unknown>[] }[];
    };
    expect(stored.series[0].events[0]).not.toHaveProperty('banks');
    expect(stored.series[0].events[1]).not.toHaveProperty('banks');
  });

  it('reports banksRequired in the summaries, derived rather than declared', async () => {
    const { id } = (await (await upload(BANKED)).json()) as { id: number };
    const list = (await (await api('/programs')).json()) as { id: number; banksRequired: number }[];

    expect(list.find((program) => program.id === 40)?.banksRequired).toBe(1);
    expect(list.find((program) => program.id === id)?.banksRequired).toBe(4);
  });

  it('replaces the overrides on a PUT', async () => {
    const { id } = (await (await upload(BANKED)).json()) as { id: number };
    await api(`/programs/${String(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...BANKED, series: [{ name: 'S', optional: false, events: [{ duration: 1000 }] }] }),
    });

    const list = (await (await api('/programs')).json()) as { id: number; banksRequired: number }[];
    expect(list.find((program) => program.id === id)?.banksRequired).toBe(1);
  });

  it('refuses to start a program that needs banks this device does not have', async () => {
    const { id } = (await (await upload(BANKED)).json()) as { id: number };
    await api(`/programs/${String(id)}/load`, { method: 'POST' });

    await expectProblem(await start(id), {
      type: '/problems/program_banks_unavailable',
      title: 'The program needs banks this device does not have',
      status: 409,
      detail: 'Program needs banks A-D; this device has one bank (A)',
    });
  });

  it('uploads and loads that same program without complaint', async () => {
    const { id } = (await (await upload(BANKED)).json()) as { id: number };
    expect((await api(`/programs/${String(id)}/load`, { method: 'POST' })).status).toBe(200);
  });
});
