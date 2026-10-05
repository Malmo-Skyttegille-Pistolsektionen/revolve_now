/**
 * The mock-only half of the mock server's suite: cases that drive the fake
 * clock, seed state only a mock can take, or would restart or reflash a real
 * device. Everything that holds on the firmware too is in `contract.test.ts`,
 * which CI also runs against QEMU (#452).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AudioFile, DiagnosticsInfo, LibraryChangedPayload, StateUpdatePayload } from '../../src/api/types';
import { PROGRAM_FALT_TRANING } from '../fixtures';
import { createFakeClock, type FakeClock } from './clock';
import { HARDWARE_DEFAULTS, createMockServer, fakeFirmwareImage, loadSeedFromDisk, type MockServer } from './server';
import { flushIO, openSSE, type SSEReader } from './sse-reader';

/** The app's tsconfig targets ES2020, so no `Array.prototype.at`. */
function last<T>(items: T[]): T {
  return items[items.length - 1];
}

// Fältträning series 1 is 28 s of wall clock on the dev server. Every
// simulated second below costs microseconds instead, which is the whole point
// of the clock seam.
const FALT_SERIES_MS = 28000;

let clock: FakeClock;
let server: MockServer;
let base: string;

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base}${path}`, init);
}

/** `POST /programs/start` for a named program - the body is required (D-27). */
async function start(id: number, init?: RequestInit): Promise<Response> {
  return api('/programs/start', { method: 'POST', body: JSON.stringify({ id }), ...init });
}

/**
 * Whether the device has gone away mid-restart. Any answer at all means it is
 * there - a 404 included, since what this tells apart is "answered" from
 * "dropped the socket".
 */
async function unreachable(): Promise<boolean> {
  return api('/version')
    .then(() => false)
    .catch(() => true);
}

/**
 * Asserts the whole RFC 9457 problem document, media type included (D-19).
 *
 * The whole document rather than just the `type`: `title` and `status` are
 * fixed per type by the firmware and must not vary between occurrences, and
 * `detail` is what a user is shown. The same four assertions run against the
 * real firmware in `e2e/`, which is what keeps this mock honest.
 */
async function expectProblem(
  res: Response,
  expected: { type: string; title: string; status: number; detail: string },
): Promise<void> {
  expect(res.status).toBe(expected.status);
  expect(res.headers.get('content-type')).toBe('application/problem+json');
  expect(await res.json()).toEqual(expected);
}

beforeEach(async () => {
  clock = createFakeClock(1_000_000);
  server = createMockServer({ clock, seed: { programs: { 40: PROGRAM_FALT_TRANING }, audios: [] } });
  base = `http://127.0.0.1:${await server.listen()}/api/v2`;
});

afterEach(async () => {
  await server.close();
});

describe('libraryChanged (D-24)', () => {
  /** A clip library, which the default seed deliberately does not have. */
  const SEED_AUDIOS: AudioFile[] = [
    { id: 3, title: 'Eld upphör', filename: '/embedded/audio/3.wav', readonly: true },
    { id: 1000, title: 'Klubbmästerskap', filename: '/userdata/audio/1000.wav', readonly: false },
  ];

  let audioServer: MockServer;
  let audioBase: string;
  let sse: SSEReader;

  beforeEach(async () => {
    audioServer = createMockServer({ clock, seed: { programs: { 40: PROGRAM_FALT_TRANING }, audios: SEED_AUDIOS } });
    audioBase = `http://127.0.0.1:${await audioServer.listen()}/api/v2`;
    sse = await openSSE(audioServer.port);
    await flushIO();
  });

  afterEach(async () => {
    sse.close();
    await audioServer.close();
  });

  function call(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${audioBase}${path}`, init);
  }

  function kinds(): string[] {
    return sse.payloads<LibraryChangedPayload>('libraryChanged').map((payload) => payload.kind);
  }

  /**
   * A minimal RIFF/WAVE body in a multipart envelope the mock will accept.
   * Every byte in it is ASCII or NUL, so a plain string is byte-for-byte what
   * a file would be - and `fetch` takes one without a Buffer conversion.
   */
  function wavUpload(title: string): { body: string; headers: Record<string, string> } {
    const boundary = '----rtmock';
    const wav = `RIFF${'\0'.repeat(4)}WAVE${'\0'.repeat(52)}`;
    const body =
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\n\r\n` +
      `${wav}\r\n--${boundary}--\r\n`;
    return { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
  }

  it('names the audio library on upload and delete', async () => {
    const { body, headers } = wavUpload('Nytt klipp');
    const created = await call('/audios', { method: 'POST', body, headers });
    expect(created.status).toBe(201);
    await flushIO();
    expect(kinds()).toEqual(['audio']);

    expect((await call('/audios/1000/delete', { method: 'DELETE' })).status).toBe(200);
    await flushIO();
    expect(kinds()).toEqual(['audio', 'audio']);
  });
});

describe('diagnostics (D-25)', () => {
  it('serves what the boot scan could not read, bounded and oldest-dropped', async () => {
    const issues = Array.from({ length: 10 }, (_, index) => ({
      code: 'program_invalid',
      message: 'Program file is malformed and was skipped',
      context: { file: `/userdata/programs/${index}.json` },
    }));
    const bounded = createMockServer({ clock, seed: { programs: {}, audios: [], startupIssues: issues } });
    const port = await bounded.listen();

    const info = (await (await fetch(`http://127.0.0.1:${port}/api/v2/diagnostics/info`)).json()) as DiagnosticsInfo;
    // Eight kept, the oldest two dropped: the array reflects where the scan
    // finished, and an array of exactly eight may be a truncated one.
    expect(info.startupIssues).toHaveLength(8);
    expect(info.startupIssues[0].context).toEqual({ file: '/userdata/programs/2.json' });
    expect(info.startupIssues[7].context).toEqual({ file: '/userdata/programs/9.json' });

    await bounded.close();
  });
});

describe('simulation on a fake clock', () => {
  let sse: SSEReader;

  beforeEach(async () => {
    sse = await openSSE(server.port);
    await flushIO();
  });

  afterEach(() => sse.close());

  it('walks the whole 28 s series, event by event, in no real time', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await start(40);
    await flushIO();

    clock.advance(FALT_SERIES_MS);
    await flushIO();

    const updates = sse.payloads<StateUpdatePayload>('stateUpdate');
    const running = updates.filter((u) => u.programState?.running);

    // One stateUpdate per whole second of the series - 28 frames, not one per
    // simulated millisecond. The ticker carries ms; the cadence stays 1 Hz.
    expect(running.map((u) => u.programState!.tickerMs)).toEqual(Array.from({ length: 28 }, (_, i) => i * 1000));

    // Targets follow the events: hidden for 10 s, then alternating 3 s.
    const shownAt = running.filter((u) => u.targetBanks.A === 'shown').map((u) => u.programState!.tickerMs);
    expect(shownAt).toEqual([10_000, 11_000, 12_000, 16_000, 17_000, 18_000, 22_000, 23_000, 24_000]);

    // Event index is derived, not counted.
    expect(running.find((u) => u.programState!.tickerMs === 17_000)!.programState!.currentEventIndex).toBe(3);
  });

  it('pauses at the start of the next series when one completes', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await start(40);
    clock.advance(FALT_SERIES_MS);
    await flushIO();

    const completed = last(sse.payloads<StateUpdatePayload>('stateUpdate'));
    expect(completed.programState).toEqual({
      running: false,
      currentSeriesIndex: 1,
      currentEventIndex: 0,
      tickerMs: null,
    });
    expect(completed.targetBanks).toEqual({ A: 'hidden' });
  });

  it('enters an event a late tick stepped over, as rt::Executor::tick does', async () => {
    // A 1 ms event closes the series: the tick that finds the series over has
    // crossed it, and its "hide" is the state the program declares.
    const program = {
      id: 41,
      title: 'Short tail',
      description: '',
      readonly: false,
      series: [
        {
          name: 'S',
          optional: false,
          events: [
            { duration: 1050, command: 'show' as const },
            { duration: 1, command: 'hide' as const },
          ],
        },
      ],
    };
    const short = createMockServer({ clock, seed: { programs: { 41: program }, audios: [] } });
    const shortBase = `http://127.0.0.1:${await short.listen()}/api/v2`;
    const shortSse = await openSSE(short.port);
    try {
      await fetch(`${shortBase}/programs/41/load`, { method: 'POST' });
      await fetch(`${shortBase}/programs/start`, { method: 'POST', body: JSON.stringify({ id: 41 }) });
      await flushIO();

      clock.advance(2000);
      await flushIO();

      const completed = last(shortSse.payloads<StateUpdatePayload>('stateUpdate'));
      expect(completed.programState?.running).toBe(false);
      expect(completed.targetBanks).toEqual({ A: 'hidden' });
    } finally {
      shortSse.close();
      await short.close();
    }
  });

  it('stop pauses and start resumes from the same millisecond', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await start(40);
    clock.advance(12_000);
    await api('/programs/stop', { method: 'POST' });
    await flushIO();

    const paused = last(sse.payloads<StateUpdatePayload>('stateUpdate'));
    expect(paused.programState).toMatchObject({ running: false, tickerMs: 12_000, currentEventIndex: 1 });

    // Time passing while paused must not move the run on.
    clock.advance(60_000);
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState!.tickerMs).toBe(12_000);

    await start(40);
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState).toMatchObject({
      running: true,
      tickerMs: 12_000,
      currentEventIndex: 1,
    });
  });

  it('stop captures the run mid-second, not the last published frame', async () => {
    // Mirrors Executor::stop. The last frame went out at 12 000 ms.
    await api('/programs/40/load', { method: 'POST' });
    await start(40);
    clock.advance(12_500);
    await api('/programs/stop', { method: 'POST' });
    await flushIO();

    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState).toMatchObject({
      running: false,
      tickerMs: 12_500,
      currentEventIndex: 1,
    });
  });

  it('reset rewinds to the top of the series', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await start(40);
    clock.advance(12_000);
    await api('/programs/stop', { method: 'POST' });
    await api('/programs/reset', { method: 'POST' });
    await flushIO();

    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState).toEqual({
      running: false,
      currentSeriesIndex: 0,
      currentEventIndex: 0,
      tickerMs: null,
    });
  });

  it('heartbeats on the 10 s cadence, off the same clock', async () => {
    clock.advance(35_000);
    await flushIO();
    expect(sse.payloads<{ id: number }>('heartbeat').map((h) => h.id)).toEqual([1, 2, 3]);
  });
});

describe('disk seed', () => {
  it('exposes uploaded audio under the firmware upload path', () => {
    const { audios } = loadSeedFromDisk();
    const writable = audios.filter((a) => !a.readonly);
    expect(writable).not.toHaveLength(0);
    // `kUploadAudioDir` in firmware/main/config.h. The mock has been wrong here
    // twice: first `/storage/uploaded/`, which existed nowhere on the device,
    // then `/storage/uploads/audio/` after #239 moved the mount to `userdata`
    // and left the mock behind. This assertion is the thing that notices.
    expect(writable.every((a) => a.filename.startsWith('/userdata/audio/'))).toBe(true);
  });
});

/**
 * Hardware configuration (#144).
 *
 * The refusals here are the ones whose recovery needs a USB cable, so they are
 * worth pinning in the mock as well as the firmware - a value the device
 * refuses and the mock accepts is a webapp test that passes against a device
 * that would have said no.
 */
describe('hardware configuration', () => {
  async function put(body: unknown): Promise<Response> {
    return api('/config/hardware', { method: 'PUT', body: JSON.stringify(body) });
  }

  /** A one-bank array on `gpio`, which is how bank A's pin is now edited. */
  async function putBankA(gpio: number): Promise<Response> {
    return put({ banks: [{ gpio, activeLow: true, name: '' }] });
  }

  async function read(): Promise<Record<string, never>> {
    return (await (await api('/config/hardware')).json()) as Record<string, never>;
  }

  // The gap between a save and the reboot that adopts it is the one thing a
  // client must not hide: a pin change that appears to have done nothing is
  // how somebody ends up reflashing a working device.
  it('reports restartRequired between a save and the restart that adopts it', async () => {
    expect((await putBankA(7)).status).toBe(200);

    const afterSave = await read();
    expect(afterSave).toMatchObject({
      active: { banks: HARDWARE_DEFAULTS.banks },
      saved: { banks: [{ gpio: 7, activeLow: true, name: '' }] },
      overridden: true,
      restartRequired: true,
    });

    server.restart();
    const afterRestart = await read();
    expect(afterRestart).toMatchObject({
      active: { banks: [{ gpio: 7, activeLow: true, name: '' }] },
      saved: { banks: [{ gpio: 7, activeLow: true, name: '' }] },
      restartRequired: false,
    });
  });

  it('keeps the fields a request does not mention', async () => {
    expect((await put({ displayName: 'Bana 1' })).status).toBe(200);
    expect((await putBankA(9)).status).toBe(200);

    const state = await read();
    expect(state).toMatchObject({ saved: { banks: [{ gpio: 9 }], displayName: 'Bana 1' } });
  });

  // 26-32 are the module's own flash and PSRAM, 35-37 the octal PSRAM's extra
  // data lines on this board, 43/44 the serial console. Driving one does not
  // fail to move a target, it stops the device booting or takes away the way
  // back in (D-41).
  it('refuses a GPIO that would stop the device booting, without storing anything', async () => {
    for (const gpio of [26, 30, 32, 22, 25, 35, 36, 37, 43, 44]) {
      const refused = await putBankA(gpio);
      await expectProblem(refused, {
        type: '/problems/hardware_config_invalid',
        title: 'Invalid hardware configuration',
        status: 400,
        detail:
          "That GPIO is wired to the module's flash or PSRAM (26-32, and 35-37 for this board's octal PSRAM), carries the serial console on UART0 (43, 44), or does not exist on this chip (22-25). Driving it stops the device booting or takes away the way back in.",
      });
    }
    expect(await read()).toMatchObject({ saved: HARDWARE_DEFAULTS, overridden: false });
  });

  it('refuses a GPIO off the chip, and one that cannot drive an output', async () => {
    expect((await putBankA(49)).status).toBe(400);
    expect((await putBankA(-1)).status).toBe(400);
    expect((await putBankA(46)).status).toBe(400);
  });

  // The hostname is the setup AP's SSID prefix as well as the mDNS name, so a
  // value that is not a legal DNS label makes the device harder to reach.
  it('refuses a hostname that is not a legal label', async () => {
    for (const hostname of ['', 'Rotation', 'has space', '-leading', 'trailing-', 'a'.repeat(21)]) {
      expect((await put({ hostname })).status).toBe(400);
    }
    expect((await put({ hostname: 'bana-1' })).status).toBe(200);
  });

  it('takes any display name up to its length', async () => {
    expect((await put({ displayName: 'Malmö Skyttegille — bana 1' })).status).toBe(200);
    expect((await put({ displayName: 'x'.repeat(41) })).status).toBe(400);
  });

  it('resets to the compiled defaults, and says a restart is needed', async () => {
    expect((await put({ banks: [{ gpio: 7, activeLow: true, name: '' }], displayName: 'Bana 1' })).status).toBe(200);
    server.restart();

    expect((await api('/config/hardware/reset', { method: 'POST' })).status).toBe(200);
    expect(await read()).toMatchObject({
      saved: HARDWARE_DEFAULTS,
      overridden: false,
      restartRequired: true,
    });
  });
});

/**
 * `POST /system/restart` (#341): the one call that applies what the two
 * configuration PUTs stored.
 */
describe('restarting the device', () => {
  const restart = async (init?: RequestInit): Promise<Response> => api('/system/restart', { method: 'POST', ...init });

  // The firmware answers, keeps serving for 1.5 s so the response drains, and
  // only then reboots - so a client that polls immediately still gets answers.
  it('answers the same shape as the OTA upload, drains, then goes away', async () => {
    await api('/config/hardware', {
      method: 'PUT',
      body: JSON.stringify({ banks: [{ gpio: 7, activeLow: true, name: '' }] }),
    });

    const res = await restart();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'accepted', restarting: true });

    expect(await unreachable()).toBe(false);
    // And it is still the device that has not restarted yet: what it reports
    // during the drain is the state it has been serving all along.
    expect(await (await api('/config/hardware')).json()).toMatchObject({
      active: { banks: HARDWARE_DEFAULTS.banks },
      restartRequired: true,
    });

    clock.advance(1500);
    expect(await unreachable()).toBe(true);
    clock.advance(1500);
    expect(await unreachable()).toBe(false);
  });

  it('comes back running what was saved, on both subjects', async () => {
    await api('/config/hardware', {
      method: 'PUT',
      body: JSON.stringify({ banks: [{ gpio: 7, activeLow: true, name: '' }] }),
    });
    await api('/wifi', { method: 'PUT', body: JSON.stringify({ ssid: 'Elsewhere' }) });

    await restart();
    clock.advance(3000);

    expect(await (await api('/config/hardware')).json()).toMatchObject({
      active: { banks: [{ gpio: 7 }] },
      restartRequired: false,
    });
    expect(await (await api('/wifi')).json()).toMatchObject({ ssid: 'Elsewhere', restartRequired: false });
  });

  // The stream is the client's only view of the device, so it has to end
  // rather than sit there looking alive.
  it('drops the SSE stream on its way down', async () => {
    const sse = await openSSE(server.port);
    try {
      await restart();
      await flushIO();
      expect(sse.closed()).toBe(true);
    } finally {
      sse.close();
    }
  });

  it('is refused while a program is running', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await start(40);
    await expectProblem(await restart(), {
      type: '/problems/program_running',
      title: 'A program is running',
      status: 409,
      detail: 'A program is running - stop it before restarting the device',
    });
    clock.advance(3000);
    expect(await unreachable()).toBe(false);
  });

  it('says so rather than claiming a restart when the device cannot start one', async () => {
    const oom = createMockServer({ clock, seed: { programs: {}, audios: [], restartFails: true } });
    const oomBase = `http://127.0.0.1:${await oom.listen()}/api/v2`;
    try {
      await expectProblem(await fetch(`${oomBase}/system/restart`, { method: 'POST' }), {
        type: '/problems/restart_failed',
        title: 'Could not start the restart',
        status: 500,
        detail:
          'Could not start the restart - the device is out of memory. Nothing has been restarted; try again, or power-cycle the device.',
      });
      // Nothing was restarted, so it is still there and still answering.
      expect((await fetch(`${oomBase}/config/hardware`)).status).toBe(200);
    } finally {
      await oom.close();
    }
  });

  it('is behind the control lock', async () => {
    expect(
      (await api('/control-lock/enable', { method: 'POST', body: JSON.stringify({ password: 'pw' }) })).status,
    ).toBe(200);

    expect((await restart({ headers: {} })).status).toBe(401);
  });

  // Deliberately not behind the configuration window (D-42).
  it('works while the configuration window is shut', async () => {
    const shut = createMockServer({ clock, seed: { programs: {}, audios: [], configWindowOpen: false } });
    const shutBase = `http://127.0.0.1:${await shut.listen()}/api/v2`;
    try {
      expect((await fetch(`${shutBase}/config/hardware`, { method: 'PUT', body: '{}' })).status).toBe(403);
      expect((await fetch(`${shutBase}/system/restart`, { method: 'POST' })).status).toBe(200);
    } finally {
      await shut.close();
    }
  });
});

/**
 * `POST /ota` (#344): `UploadSession` in firmware/lib/rt_logic/ota_upload.h,
 * whose host test drives the same table. Each request answers for itself -
 * the two defects #342 fixed were answers carried over from the previous one.
 */
describe('firmware upload', () => {
  const upload = async (image: Buffer | null, init?: RequestInit, target = base): Promise<Response> => {
    const body = new FormData();
    if (image !== null) body.append('file', new Blob([new Uint8Array(image)]), 'revolve_now.bin');
    return fetch(`${target}/ota`, { method: 'POST', body, ...init });
  };
  const emptyImage = {
    type: '/problems/ota_image_refused',
    title: 'Firmware image refused',
    status: 400,
    detail: 'The upload was empty or too small to be a firmware image',
  };
  const restartFailed = {
    type: '/problems/restart_failed',
    title: 'Could not start the restart',
    status: 500,
    detail:
      'The firmware was installed and is the boot partition, but the restart could not be started. Power-cycle the device to run it.',
  };

  it('accepts an image for this project, drains, then goes away', async () => {
    const res = await upload(fakeFirmwareImage());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'accepted', restarting: true });

    expect(await unreachable()).toBe(false);
    clock.advance(1500);
    expect(await unreachable()).toBe(true);
    clock.advance(1500);
    expect(await unreachable()).toBe(false);
  });

  it('writes nothing and starts nothing between an accepted image and the restart', async () => {
    expect((await upload(fakeFirmwareImage())).status).toBe(200);

    // The next upload would be written over the image just installed.
    await expectProblem(await upload(fakeFirmwareImage()), {
      type: '/problems/restart_pending',
      title: 'The device is restarting',
      status: 409,
      detail: 'A firmware update was just installed and the device is restarting into it - wait for it to come back',
    });
    await api('/programs/40/load', { method: 'POST' });
    await expectProblem(await start(40), {
      type: '/problems/program_running',
      title: 'A program is running',
      status: 409,
      detail: 'A firmware update is in progress - wait for the device to restart',
    });

    clock.advance(3000);
    expect((await upload(fakeFirmwareImage('AutoLee'))).status).toBe(400);
  });

  it('refuses while a program is running, with 409', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await start(40);
    await expectProblem(await upload(fakeFirmwareImage()), {
      type: '/problems/program_running',
      title: 'A program is running',
      status: 409,
      detail: 'A program is running - stop it before updating the firmware',
    });
  });

  it('refuses an image for another project, with 400', async () => {
    await expectProblem(await upload(fakeFirmwareImage('AutoLee')), {
      type: '/problems/ota_image_refused',
      title: 'Firmware image refused',
      status: 400,
      detail: 'That firmware is for a different device - upload refused',
    });
  });

  it('refuses a name that only starts the same', async () => {
    expect((await upload(fakeFirmwareImage('rotation_target_backend'))).status).toBe(400);
  });

  it('refuses a readable header with nothing behind it as too small', async () => {
    await expectProblem(await upload(fakeFirmwareImage(undefined, 256)), emptyImage);
  });

  it('answers an empty file part for itself, not with the previous refusal', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await start(40);
    expect((await upload(fakeFirmwareImage())).status).toBe(409);

    // Not even the running program is checked: the device never reaches
    // onUpload for an empty part.
    await expectProblem(await upload(Buffer.alloc(0)), emptyImage);
    await expectProblem(await upload(null), emptyImage);
  });

  it('answers a raw body with a problem detail, before reading it', async () => {
    await expectProblem(
      await fetch(`${base}/ota`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(fakeFirmwareImage()),
      }),
      {
        type: '/problems/upload_missing_file',
        title: 'No file uploaded',
        status: 400,
        detail: 'Expected a multipart/form-data body with the image in a file part',
      },
    );
  });

  it('is behind the control lock', async () => {
    expect(
      (await api('/control-lock/enable', { method: 'POST', body: JSON.stringify({ password: 'pw' }) })).status,
    ).toBe(200);
    expect((await upload(fakeFirmwareImage())).status).toBe(401);
  });

  it('refuses every later upload with restart_failed until a power cycle', async () => {
    const oom = createMockServer({ clock, seed: { programs: {}, audios: [], restartFails: true } });
    const oomBase = `http://127.0.0.1:${await oom.listen()}/api/v2`;
    try {
      await expectProblem(await upload(fakeFirmwareImage(), undefined, oomBase), restartFailed);
      // The next upload would be written over the image waiting to run.
      await expectProblem(await upload(fakeFirmwareImage(), undefined, oomBase), restartFailed);
      await expectProblem(await upload(Buffer.alloc(0), undefined, oomBase), restartFailed);
      await expectProblem(
        await fetch(`${oomBase}/ota`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' } }),
        restartFailed,
      );

      oom.restart();
      expect((await upload(fakeFirmwareImage('AutoLee'), undefined, oomBase)).status).toBe(400);
    } finally {
      await oom.close();
    }
  });
});

describe('WiFi (#263)', () => {
  // Public, like every other GET. The device's own network placement is not a
  // secret from anyone who can already see the device.
  it('reports the association without a password member of any kind', async () => {
    const status = (await (await api('/wifi')).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ radioPresent: true, connected: true, provisioned: true });
    expect(Object.keys(status)).not.toContain('password');
  });

  // Behind the window rather than public, unlike every other GET: a scan takes
  // the radio off its channel, so it is a read that costs the network it is
  // served over.
  it('refuses a scan while the configuration window is shut', async () => {
    const shut = createMockServer({ clock, seed: { programs: {}, audios: [], configWindowOpen: false } });
    const shutBase = `http://127.0.0.1:${await shut.listen()}/api/v2`;
    try {
      await expectProblem(await fetch(`${shutBase}/wifi/networks`), {
        type: '/problems/hardware_config_window_closed',
        title: 'The configuration window is closed',
        status: 403,
        detail:
          'Press the BOOT button on the device (marked BOOT or FLASH) three times within ten seconds to open a five-minute configuration window, then try again.',
      });
    } finally {
      await shut.close();
    }
  });

  it('lists what the scan heard, strongest first and one entry per SSID', async () => {
    const { networks } = (await (await api('/wifi/networks')).json()) as {
      networks: { ssid: string; rssi: number }[];
    };
    expect(networks.length).toBeGreaterThan(0);
    expect([...networks].sort((a, b) => b.rssi - a.rssi)).toEqual(networks);
    expect(new Set(networks.map((n) => n.ssid)).size).toBe(networks.length);
  });

  // #341: the PUT stores and stops there, so the device is still on the network
  // this request arrived over afterwards.
  it('stores credentials and stays on the network until the restart adopts them', async () => {
    const before = (await (await api('/wifi')).json()) as { ssid: string };

    const saved = await api('/wifi', {
      method: 'PUT',
      body: JSON.stringify({ ssid: 'Elsewhere', password: 'hunter22' }),
    });
    expect(saved.status).toBe(200);

    const status = (await (await api('/wifi')).json()) as {
      ssid: string;
      provisioned: boolean;
      restartRequired: boolean;
    };
    expect(status.ssid).toBe(before.ssid);
    expect(status.restartRequired).toBe(true);
    // On a real device this is the marker a factory reset had cleared: saving
    // lifts the suppression, so the compiled seeds come back as fallbacks. It
    // is a property of NVS, so it is true before the restart.
    expect(status.provisioned).toBe(true);

    server.restart();
    const after = (await (await api('/wifi')).json()) as { ssid: string; restartRequired: boolean };
    expect(after.ssid).toBe('Elsewhere');
    expect(after.restartRequired).toBe(false);
  });

  it('refuses a nameless network rather than storing one', async () => {
    await expectProblem(await api('/wifi', { method: 'PUT', body: JSON.stringify({ ssid: '' }) }), {
      type: '/problems/wifi_credentials_invalid',
      title: 'Invalid WiFi credentials',
      status: 400,
      detail: 'Choose a network from the list, or type its name',
    });
  });

  it('refuses the bounds the 802.11 frames impose', async () => {
    await expectProblem(await api('/wifi', { method: 'PUT', body: JSON.stringify({ ssid: 'x'.repeat(33) }) }), {
      type: '/problems/wifi_credentials_invalid',
      title: 'Invalid WiFi credentials',
      status: 400,
      detail: 'A network name is at most 32 characters',
    });
    await expectProblem(
      await api('/wifi', { method: 'PUT', body: JSON.stringify({ ssid: 'ok', password: 'p'.repeat(64) }) }),
      {
        type: '/problems/wifi_credentials_invalid',
        title: 'Invalid WiFi credentials',
        status: 400,
        detail: 'A WiFi password is at most 63 characters',
      },
    );
  });
});

/** A device with `count` banks, each on its own pin, already booted on them. */
async function withBanks(count: number): Promise<{ server: MockServer; base: string }> {
  const banks = Array.from({ length: count }, (_, index) => ({
    gpio: 5 + index,
    activeLow: true,
    name: index === 0 ? 'Vänster' : `Bana ${String(index + 1)}`,
  }));
  const banked = createMockServer({
    clock,
    seed: {
      programs: { 40: PROGRAM_FALT_TRANING },
      audios: [],
      hardware: { ...HARDWARE_DEFAULTS, banks },
    },
  });
  const port = await banked.listen();
  return { server: banked, base: `http://127.0.0.1:${String(port)}/api/v2` };
}

/**
 * Target banks (#207, D-41). The mock mirrors `rt::Executor`'s per-bank state,
 * so a webapp test that drives a four-bank device is testing against the rules
 * the firmware actually applies.
 */
describe('target banks', () => {
  // Mock-only because the emulator discards GPIO writes and reads every pad
  // back as 0 (firmware/docs/QEMU.md).
  it('hide actually hides', async () => {
    await api('/targets/show', { method: 'POST' });
    const res = await api('/targets/hide', { method: 'POST' });

    expect(await res.json()).toEqual({ message: 'Targets hidden' });
    // `activeLow` is true here, so hidden is the *high* pad level: the field is
    // the raw read-back, not what it means.
    const info = (await (await api('/diagnostics/info')).json()) as DiagnosticsInfo;
    expect(info.banks[0].padLevel).toBe(1);
  });

  it('publishes one key per bank on a device with several', async () => {
    const four = await withBanks(4);
    const sse = await openSSE(four.server.port);
    try {
      await fetch(`${four.base}/targets/hide`, { method: 'POST' });
      await fetch(`${four.base}/targets/show`, { method: 'POST', body: JSON.stringify({ banks: ['B', 'D'] }) });
      await flushIO();
      const update = last(sse.payloads<StateUpdatePayload>('stateUpdate'));
      expect(update.targetBanks).toEqual({ A: 'hidden', B: 'shown', C: 'hidden', D: 'shown' });
    } finally {
      sse.close();
      await four.server.close();
    }
  });

  it('a bodyless call moves every bank', async () => {
    const four = await withBanks(4);
    try {
      await fetch(`${four.base}/targets/show`, { method: 'POST', body: JSON.stringify({ banks: ['B'] }) });
      const res = await fetch(`${four.base}/targets/hide`, { method: 'POST' });

      expect(await res.json()).toEqual({ message: 'Targets hidden' });
      const info = (await (await fetch(`${four.base}/diagnostics/info`)).json()) as DiagnosticsInfo;
      // activeLow: hidden reads high.
      expect(info.banks?.map((bank) => bank.padLevel)).toEqual([1, 1, 1, 1]);
    } finally {
      await four.server.close();
    }
  });

  // One button has to resolve a strip that may disagree with itself, so a
  // mixed strip cannot stay mixed.
  it('a bodyless toggle hides only when every bank is shown', async () => {
    const four = await withBanks(4);
    try {
      const levels = async (): Promise<number[]> => {
        const info = (await (await fetch(`${four.base}/diagnostics/info`)).json()) as DiagnosticsInfo;
        return info.banks?.map((bank) => bank.padLevel) ?? [];
      };
      const toggle = (): Promise<Response> => fetch(`${four.base}/targets/toggle`, { method: 'POST' });

      await toggle();
      expect(await levels()).toEqual([1, 1, 1, 1]);
      await toggle();
      expect(await levels()).toEqual([0, 0, 0, 0]);

      // From mixed: show all, not "flip each".
      await fetch(`${four.base}/targets/show`, { method: 'POST', body: JSON.stringify({ banks: ['B'] }) });
      await toggle();
      expect(await levels()).toEqual([1, 1, 1, 1]);
    } finally {
      await four.server.close();
    }
  });

  it('a named toggle flips each bank against its own state', async () => {
    const four = await withBanks(4);
    try {
      await fetch(`${four.base}/targets/hide`, { method: 'POST' });
      await fetch(`${four.base}/targets/show`, { method: 'POST', body: JSON.stringify({ banks: ['B'] }) });
      const res = await fetch(`${four.base}/targets/toggle`, {
        method: 'POST',
        body: JSON.stringify({ banks: ['B', 'C', 'D'] }),
      });

      expect(await res.json()).toEqual({ message: 'Banks C and D shown, bank B hidden' });
      // activeLow: shown reads low. A and B hidden, C and D shown.
      const info = (await (await fetch(`${four.base}/diagnostics/info`)).json()) as DiagnosticsInfo;
      expect(info.banks?.map((bank) => bank.padLevel)).toEqual([1, 1, 0, 0]);
    } finally {
      await four.server.close();
    }
  });

  it('refuses a letter the device does not have, and moves nothing', async () => {
    const three = await withBanks(3);
    try {
      await fetch(`${three.base}/targets/hide`, { method: 'POST' });
      const res = await fetch(`${three.base}/targets/show`, {
        method: 'POST',
        body: JSON.stringify({ banks: ['A', 'E'] }),
      });

      await expectProblem(res, {
        type: '/problems/bank_unavailable',
        title: 'No such target bank',
        status: 400,
        detail: "'E' is not a bank on this device, which has banks A-C.",
      });
      // Still every bank hidden, which with activeLow reads high.
      const info = (await (await fetch(`${three.base}/diagnostics/info`)).json()) as DiagnosticsInfo;
      expect(info.banks?.map((bank) => bank.padLevel)).toEqual([1, 1, 1]);
    } finally {
      await three.server.close();
    }
  });

  // The body cases `host_test/test_target_bank/test_target_bank.cpp` covers on
  // the device, asserted against the mock so the two cannot drift.
  it('treats {} as the bodyless call', async () => {
    const four = await withBanks(4);
    try {
      const res = await fetch(`${four.base}/targets/hide`, { method: 'POST', body: '{}' });

      expect(await res.json()).toEqual({ message: 'Targets hidden' });
    } finally {
      await four.server.close();
    }
  });

  it('accepts a repeated letter, because it asks for nothing extra', async () => {
    const four = await withBanks(4);
    try {
      await fetch(`${four.base}/targets/hide`, { method: 'POST' });
      const res = await fetch(`${four.base}/targets/show`, {
        method: 'POST',
        body: JSON.stringify({ banks: ['B', 'B'] }),
      });

      expect(await res.json()).toEqual({ message: 'Bank B shown' });
    } finally {
      await four.server.close();
    }
  });

  // A program's `command` means every bank, which is what it has always meant
  // and why no existing program needs migrating. The per-event `banks` override
  // is stage 3.
  it('a program event drives every bank together', async () => {
    const four = await withBanks(4);
    const sse = await openSSE(four.server.port);
    try {
      // Start from a strip that disagrees with itself, so "every bank" is
      // visible in the result rather than coincidental.
      await fetch(`${four.base}/targets/show`, { method: 'POST', body: JSON.stringify({ banks: ['B'] }) });
      await fetch(`${four.base}/programs/40/load`, { method: 'POST' });
      await fetch(`${four.base}/programs/start`, { method: 'POST', body: JSON.stringify({ id: 40 }) });
      await flushIO();

      // Every bank in step, whichever way the event's `command` sent them -
      // the point is that none was left behind by the earlier per-bank call.
      const update = last(sse.payloads<StateUpdatePayload>('stateUpdate'));
      const states = Object.values(update.targetBanks);
      expect(states).toHaveLength(4);
      expect(new Set(states).size).toBe(1);
    } finally {
      sse.close();
      await four.server.close();
    }
  });

  it('reports the banks it booted on, names and all', async () => {
    const two = await withBanks(2);
    try {
      const state = (await (await fetch(`${two.base}/config/hardware`)).json()) as {
        active: { banks: { gpio: number; activeLow: boolean; name: string }[] };
      };
      expect(state.active.banks).toEqual([
        { gpio: 5, activeLow: true, name: 'Vänster' },
        { gpio: 6, activeLow: true, name: 'Bana 2' },
      ]);
    } finally {
      await two.server.close();
    }
  });

  it('accepts a banks array and adopts it at the next restart', async () => {
    const banks = [
      { gpio: 5, activeLow: true, name: 'Vänster' },
      { gpio: 6, activeLow: false, name: 'Höger' },
    ];
    expect((await api('/config/hardware', { method: 'PUT', body: JSON.stringify({ banks }) })).status).toBe(200);

    const saved = (await (await api('/config/hardware')).json()) as {
      saved: { banks: unknown[] };
      active: { banks: unknown[] };
      restartRequired: boolean;
    };
    expect(saved.saved.banks).toEqual(banks);
    expect(saved.active.banks).toHaveLength(1);
    expect(saved.restartRequired).toBe(true);

    server.restart();
    const afterRestart = (await (await api('/config/hardware')).json()) as { active: { banks: unknown[] } };
    expect(afterRestart.active.banks).toEqual(banks);
  });

  // The array replaces what is stored rather than merging into it: a body
  // naming one bank leaves a three-bank device with one, which is what makes
  // "edit a bank" mean "send them all".
  it('a banks array replaces the whole array', async () => {
    const three = await withBanks(3);
    try {
      expect(
        (
          await fetch(`${three.base}/config/hardware`, {
            method: 'PUT',
            body: JSON.stringify({ banks: [{ gpio: 13, activeLow: true, name: 'Vänster' }] }),
          })
        ).status,
      ).toBe(200);

      const saved = (await (await fetch(`${three.base}/config/hardware`)).json()) as {
        saved: { banks: { gpio: number; name: string }[] };
      };
      expect(saved.saved.banks.map((bank) => bank.gpio)).toEqual([13]);
      expect(saved.saved.banks[0].name).toBe('Vänster');
    } finally {
      await three.server.close();
    }
  });

  // Where the targets rest at boot is one setting for every bank (D-31), and a
  // stock device rests shown. A boot that hid them regardless would be a state
  // no device produces - and the state somebody standing downrange is not
  // expecting.
  it('boots every bank to targetsShownAtBoot', async () => {
    const four = await withBanks(4);
    try {
      const info = (await (await fetch(`${four.base}/diagnostics/info`)).json()) as DiagnosticsInfo;
      // activeLow: shown reads low on every pad.
      expect(info.banks?.map((bank) => bank.padLevel)).toEqual([0, 0, 0, 0]);

      await fetch(`${four.base}/targets/hide`, { method: 'POST' });
      four.server.reset();

      const afterReset = (await (await fetch(`${four.base}/diagnostics/info`)).json()) as DiagnosticsInfo;
      expect(afterReset.banks?.map((bank) => bank.padLevel)).toEqual([0, 0, 0, 0]);
    } finally {
      await four.server.close();
    }
  });

  // `Executor::reset()` does not touch bank state: the targets do not move
  // because a program was rewound.
  it('leaves the banks alone when a program is reset', async () => {
    const four = await withBanks(4);
    try {
      await fetch(`${four.base}/targets/hide`, { method: 'POST', body: JSON.stringify({ banks: ['B'] }) });
      await fetch(`${four.base}/programs/40/load`, { method: 'POST' });
      const before = (await (await fetch(`${four.base}/diagnostics/info`)).json()) as DiagnosticsInfo;

      expect((await fetch(`${four.base}/programs/reset`, { method: 'POST' })).status).toBe(200);

      const after = (await (await fetch(`${four.base}/diagnostics/info`)).json()) as DiagnosticsInfo;
      expect(after.banks?.map((bank) => bank.padLevel)).toEqual(before.banks?.map((bank) => bank.padLevel));
    } finally {
      await four.server.close();
    }
  });

  it('refuses a banks array that is not one', async () => {
    for (const banks of ['nope', 42, [5]]) {
      const res = await api('/config/hardware', { method: 'PUT', body: JSON.stringify({ banks }) });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { detail: string }).detail).toContain("'banks'");
    }
  });

  // `doc["banks"].isNull()` on the device: absent and null are the same body.
  // A client that clears a field it does not understand keeps what is stored.
  it('reads a null banks as absent, not as a refusal', async () => {
    const res = await api('/config/hardware', {
      method: 'PUT',
      body: JSON.stringify({ banks: null, displayName: 'Bana 1' }),
    });

    expect(res.status).toBe(200);
    const state = (await (await api('/config/hardware')).json()) as {
      saved: { banks: unknown[]; displayName: string };
    };
    expect(state.saved.banks).toEqual(HARDWARE_DEFAULTS.banks);
    expect(state.saved.displayName).toBe('Bana 1');
  });

  // The device reads each field with a default (`entry["gpio"] | 0`), so a
  // half-written entry arrives at validation as GPIO 0 and is refused there -
  // never as a 500, which is what the mock used to answer.
  it('refuses a bank entry missing its pin, the way the device does', async () => {
    const res = await api('/config/hardware', {
      method: 'PUT',
      body: JSON.stringify({ banks: [{ name: 'Vänster' }] }),
    });

    await expectProblem(res, {
      type: '/problems/hardware_config_invalid',
      title: 'Invalid hardware configuration',
      status: 400,
      detail:
        'GPIO 0 and 45 are read at reset to decide how the chip boots. Driving one can stop the device starting at all.',
    });
  });

  it('refuses an empty banks array rather than reading it as a default', async () => {
    const res = await api('/config/hardware', { method: 'PUT', body: JSON.stringify({ banks: [] }) });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { detail: string }).detail).toContain('one and 8');
  });

  it('refuses two banks on the same pin', async () => {
    const res = await api('/config/hardware', {
      method: 'PUT',
      body: JSON.stringify({
        banks: [
          { gpio: 5, activeLow: true, name: '' },
          { gpio: 5, activeLow: true, name: '' },
        ],
      }),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { detail: string }).detail).toContain('same GPIO');
  });

  it('refuses more than eight banks', async () => {
    const banks = Array.from({ length: 9 }, (_, index) => ({
      gpio: 5 + index,
      activeLow: true,
      name: '',
    }));
    const res = await api('/config/hardware', { method: 'PUT', body: JSON.stringify({ banks }) });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { detail: string }).detail).toContain('one and 8');
  });
});

describe('target banks, program side', () => {
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

  /** A second device, because the bank count is fixed at boot. Stage 2's helper, reused. */
  async function deviceWithBanks(count: number): Promise<{ close: () => Promise<void>; base: string }> {
    const { server: banked, base: bankedBase } = await withBanks(count);
    return { close: () => banked.close(), base: bankedBase };
  }

  // The mirror seam: this is `rt::Executor::enter_event`, and a webapp test
  // that drives a four-bank device is only worth anything if it matches.
  it('drives each bank where its event names it, and leaves the rest to command', async () => {
    const four = await withBanks(4);
    const sse = await openSSE(four.server.port);
    try {
      const created = await fetch(`${four.base}/programs`, {
        method: 'POST',
        body: JSON.stringify({
          title: 'Sequential',
          description: '',
          series: [
            {
              name: 'S',
              optional: false,
              events: [
                { duration: 1000, command: 'hide', banks: { B: 'show' } },
                { duration: 1000, banks: { C: 'show' } },
                { duration: 1000 },
              ],
            },
          ],
        }),
      });
      const { id } = (await created.json()) as { id: number };
      await fetch(`${four.base}/programs/${String(id)}/load`, { method: 'POST' });
      await fetch(`${four.base}/programs/start`, { method: 'POST', body: JSON.stringify({ id }) });

      const banksNow = (): Record<string, string> =>
        last(sse.payloads<StateUpdatePayload>('stateUpdate')).targetBanks ?? {};

      await flushIO();
      // Event 0: hide is the baseline, B is the exception.
      expect(banksNow()).toEqual({ A: 'hidden', B: 'shown', C: 'hidden', D: 'hidden' });

      // Event 1 names C and carries no command, so A, B and D stay put.
      clock.advance(1000);
      await flushIO();
      expect(banksNow()).toEqual({ A: 'hidden', B: 'shown', C: 'shown', D: 'hidden' });

      // Event 2 names nothing and commands nothing: a timed pause moves nothing.
      clock.advance(1000);
      await flushIO();
      expect(banksNow()).toEqual({ A: 'hidden', B: 'shown', C: 'shown', D: 'hidden' });
    } finally {
      sse.close();
      await four.server.close();
    }
  });

  it('starts it on a device that has the banks', async () => {
    const device = await deviceWithBanks(4);
    try {
      const created = await fetch(`${device.base}/programs`, { method: 'POST', body: JSON.stringify(BANKED) });
      const { id } = (await created.json()) as { id: number };
      await fetch(`${device.base}/programs/${String(id)}/load`, { method: 'POST' });

      const res = await fetch(`${device.base}/programs/start`, { method: 'POST', body: JSON.stringify({ id }) });
      expect(res.status).toBe(200);
    } finally {
      await device.close();
    }
  });
});
