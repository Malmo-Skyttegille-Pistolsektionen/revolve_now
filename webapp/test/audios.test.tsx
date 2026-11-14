// @vitest-environment happy-dom
// Same-origin with the mock server, for the reason spelled out in
// useControlLockStatus.test.tsx: the mock implements no CORS allowlist.
// @vitest-environment-options { "url": "http://127.0.0.1:18081" }
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { MAX_FILE_BYTES, MAX_UPLOAD_BYTES } from '../src/api/audios';
import { MAX_COMPRESSED_SOURCE_BYTES } from '../src/lib/audio-convert';
import { encodeImaAdpcmWav } from '../src/lib/ima-adpcm';
import type { AudioFile, BackendIssuePayload } from '../src/api/types';
import { SettingsProvider } from '../src/context/SettingsContext';
import { Route } from '../src/routes/audios';
import { useSSE } from '../src/hooks/useSSE';
import { FakeEventSource } from './fake-event-source';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';
import { enableControlLockElsewhere } from './other-client';
import { backendIssueAtom } from '../src/lib/sse-store';

// Out of the Linux ephemeral range, and not the port useControlLockStatus.test.tsx
// binds — vitest runs the two files in parallel.
const PORT = 18081;

const AudiosView = Route.options.component!;

/** Deliberately out of id order: the view is what sorts. */
const SEED_AUDIOS: AudioFile[] = [
  { id: 3, title: 'Eld upphör', filename: '/embedded/audio/3.wav', readonly: true },
  { id: 1, title: 'Färdiga', filename: '/embedded/audio/1.wav', readonly: true },
  { id: 1000, title: 'Klubbmästerskap 2026', filename: '/userdata/audio/1000.wav', readonly: false },
];

/** A minimal RIFF/WAVE header — enough for the mock's format check. */
function wavFile(name = 'signal.wav', byteLength = 64): File {
  const bytes = new Uint8Array(byteLength);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WAVE'), 8);
  return new File([bytes], name, { type: 'audio/wav' });
}

/**
 * happy-dom has no Web Audio, so any pick not stubbed here takes the
 * undecodable-WAV path. Only `decodeAudioData` is used, so that is all the
 * stand-in offers; the real thing is exercised in a browser.
 *
 * Also stands in for the duration probe on files over 1 MiB: happy-dom's
 * `Audio` never loads, so the probe would sit out its timeout. `probedSeconds`
 * null is a browser that cannot tell.
 */
function stubDecoder(
  decode: () => Promise<AudioBuffer>,
  probedSeconds: number | null = null,
): Mock<() => Promise<AudioBuffer>> {
  const spy = vi.fn(decode);
  vi.stubGlobal(
    'OfflineAudioContext',
    class {
      decodeAudioData = spy;
    },
  );
  vi.stubGlobal(
    'Audio',
    class {
      duration = probedSeconds ?? NaN;
      onloadedmetadata: (() => void) | null = null;
      onerror: (() => void) | null = null;
      preload = '';
      removeAttribute(): void {}
      set src(_url: string) {
        queueMicrotask(() => (probedSeconds === null ? this.onerror?.() : this.onloadedmetadata?.()));
      }
    },
  );
  return spy;
}

/** A quiet ramp, the same on every channel unless `channels` says otherwise. */
function ramp(length: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => ((i % 200) - 100) / 400);
}

/** A decoded clip at the converter's own rate. */
function fakeAudioBuffer(length: number, numberOfChannels: number, channels?: Float32Array[]): AudioBuffer {
  const data = ramp(length);
  return {
    length,
    numberOfChannels,
    sampleRate: 24_000,
    getChannelData: (channel: number) => channels?.[channel] ?? data,
  } as unknown as AudioBuffer;
}

/** The tool-generated ADPCM fixture: already in the device's format. */
function adpcmFile(name: string): File {
  const bytes = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data/adpcm/chirp-adpcm.wav'));
  return new File([bytes], name, { type: 'audio/wav' });
}

let server: MockServer;
let clock: ReturnType<typeof createFakeClock>;
let queryClient: QueryClient;

function renderAudios() {
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <AudiosView />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

/** POST /audios calls seen by a `fetch` spy. */
function uploadCalls(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.filter(
    (call) => String(call[0]).endsWith('/audios') && (call[1] as RequestInit | undefined)?.method === 'POST',
  );
}

/** No jest-dom in this suite — assert on the text directly. */
function text(element: HTMLElement): string {
  return element.textContent ?? '';
}

/** The list has arrived and rendered. */
async function waitForClips(): Promise<void> {
  await screen.findByTestId('audios-row-1');
}

/** Picks a file and waits out the conversion every pick now goes through. */
async function selectFile(file: File): Promise<void> {
  const input = screen.getByTestId('audios-upload-file');
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(text(screen.getByTestId('audios-upload-submit'))).not.toBe('Converting…'));
}

beforeAll(async () => {
  clock = createFakeClock();
  server = createMockServer({ clock, port: PORT, seed: { programs: {}, audios: [...SEED_AUDIOS] } });
  await server.listen();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  server.reset();
  localStorage.clear();
  document.cookie = 'control_lock=; Path=/; Max-Age=0';
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
});

describe('the audio library', () => {
  it('lists every clip in id order, marking shipped and uploaded apart', async () => {
    renderAudios();
    await waitForClips();

    const ids = screen.getAllByTestId(/^audios-row-/).map((row) => row.getAttribute('data-testid'));
    expect(ids).toEqual(['audios-row-1', 'audios-row-3', 'audios-row-1000']);

    expect(text(screen.getByTestId('audios-source-1'))).toBe('Shipped');
    expect(text(screen.getByTestId('audios-source-3'))).toBe('Shipped');
    expect(text(screen.getByTestId('audios-source-1000'))).toBe('Uploaded');

    expect(within(screen.getByTestId('audios-row-1000')).getByText('Klubbmästerskap 2026')).toBeTruthy();
  });

  it('offers Delete on uploaded clips only — a shipped one is refused with 409', async () => {
    renderAudios();
    await waitForClips();

    expect(screen.queryByTestId('audios-delete-1')).toBeNull();
    expect(screen.queryByTestId('audios-delete-3')).toBeNull();
    expect(screen.getByTestId('audios-delete-1000')).toBeTruthy();

    // Play is offered for both.
    expect(screen.getByTestId('audios-play-1')).toBeTruthy();
    expect(screen.getByTestId('audios-play-1000')).toBeTruthy();
  });
});

describe('the control lock gates the mutating controls', () => {
  it('lock ON without a token: view only, no upload form and no row actions', async () => {
    await enableControlLockElsewhere(PORT, 'competition-2026');

    renderAudios();
    await waitForClips();

    await screen.findByTestId('audios-view-only');
    expect(screen.queryByTestId('audios-upload-form')).toBeNull();
    expect(screen.queryByTestId('audios-play-1')).toBeNull();
    expect(screen.queryByTestId('audios-delete-1000')).toBeNull();
  });

  it('lock ON with a token: the controls come back', async () => {
    await enableControlLockElsewhere(PORT, 'competition-2026');
    localStorage.setItem('rt_settings_control_lock_token', 'a-token');

    renderAudios();
    await waitForClips();

    expect(screen.getByTestId('audios-upload-form')).toBeTruthy();
    expect(screen.getByTestId('audios-play-1')).toBeTruthy();
    expect(screen.queryByTestId('audios-view-only')).toBeNull();
  });

  it('a 401 drops the stale token, and the controls go away with it', async () => {
    // The password-changed case: the lock was cycled elsewhere, so this
    // client's token is no longer one the device knows.
    await enableControlLockElsewhere(PORT, 'competition-2026');
    localStorage.setItem('rt_settings_control_lock_token', 'a-token-from-a-previous-session');

    renderAudios();
    await waitForClips();
    fireEvent.click(await screen.findByTestId('audios-play-1'));

    // `client.ts` calls `logoutControlLock` on the 401, which is what takes the
    // controls away — the user is told, not left with buttons that do nothing.
    await screen.findByTestId('audios-view-only');
    expect(localStorage.getItem('rt_settings_control_lock_token')).toBeNull();
    expect(screen.queryByTestId('audios-play-1')).toBeNull();
    expect(text(screen.getByTestId('audios-feedback'))).toMatch(/Could not play "Färdiga"/);
  });

  it('lock OFF: everyone controls, as the device allows', async () => {
    renderAudios();
    await waitForClips();

    expect(screen.getByTestId('audios-upload-form')).toBeTruthy();
    expect(screen.queryByTestId('audios-view-only')).toBeNull();
  });
});

describe('upload', () => {
  it('fills the title from the filename, the way the legacy tab did', async () => {
    renderAudios();
    await waitForClips();

    await selectFile(wavFile('eld-upphor.wav'));

    await waitFor(() =>
      expect((screen.getByTestId('audios-upload-title') as HTMLInputElement).value).toBe('eld-upphor'),
    );
  });

  it('refuses an oversized WAV the browser cannot convert, without troubling the device', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderAudios();
    await waitForClips();

    await selectFile(wavFile('too-big.wav', MAX_UPLOAD_BYTES + 1));

    const feedback = await screen.findByTestId('audios-feedback');
    expect(text(feedback)).toMatch(/"too-big.wav" is \d+ bytes/);
    expect(feedback.getAttribute('role')).toBe('alert');
    // Nothing to submit: the file was never accepted.
    expect((screen.getByTestId('audios-upload-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(uploadCalls(fetchSpy)).toHaveLength(0);
  });

  it('refuses a WAV of exactly 1 MiB the browser cannot convert — the envelope pushes it over', async () => {
    // The device checks Content-Length, not the file's length, so a file at
    // the nominal ceiling is always refused on the wire. Caught here instead.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderAudios();
    await waitForClips();

    await selectFile(wavFile('exactly-one-mib.wav', MAX_UPLOAD_BYTES));

    expect(text(await screen.findByTestId('audios-feedback'))).toMatch(
      new RegExp(`at most ${MAX_FILE_BYTES} bytes per clip`),
    );
    expect(uploadCalls(fetchSpy)).toHaveLength(0);
  });

  it('refuses a file that is not a .wav when the browser cannot convert it, naming it', async () => {
    // Neither convertible nor named .wav, so it must not reach the device,
    // where the extension check surfaces as `No file uploaded`.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    stubDecoder(() => Promise.reject(new DOMException('Unable to decode', 'EncodingError')));

    renderAudios();
    await waitForClips();

    await selectFile(new File([new Uint8Array(32)], 'fanfar.ogg', { type: 'audio/ogg' }));

    expect(text(await screen.findByTestId('audios-feedback'))).toMatch(/could not read "fanfar.ogg" as audio/);
    expect((screen.getByTestId('audios-upload-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(uploadCalls(fetchSpy)).toHaveLength(0);
  });

  it('converts an M4A to an IMA ADPCM WAV and uploads that (#273)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // Stereo with a silent right channel, so a mixdown that dropped a channel
    // or forgot to average would send different bytes.
    const left = ramp(24_000);
    stubDecoder(() => Promise.resolve(fakeAudioBuffer(24_000, 2, [left, new Float32Array(24_000)])));

    renderAudios();
    await waitForClips();

    await selectFile(new File([new Uint8Array(32)], 'Eld upphör.m4a', { type: 'audio/mp4' }));
    expect(text(await screen.findByTestId('audios-feedback'))).toMatch(/Converted "Eld upphör.m4a": 1.0 s/);
    expect((screen.getByTestId('audios-upload-title') as HTMLInputElement).value).toBe('Eld upphör');

    fireEvent.click(screen.getByTestId('audios-upload-submit'));
    await screen.findByTestId('audios-row-1001');

    const [, init] = uploadCalls(fetchSpy)[0] as [string, RequestInit];
    const sent = (init.body as FormData).get('file') as File;
    // The device reads only the extension, and a short name leaves the
    // multipart envelope room under the cap.
    expect(sent.name).toBe('upload.wav');
    const expected = encodeImaAdpcmWav(
      Int16Array.from(left, (v) => Math.round((v / 2) * 32768)),
      24_000,
    );
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(expected);
  });

  it('keeps the newer pick when an older conversion finishes after it', async () => {
    let finishFirst!: (buffer: AudioBuffer) => void;
    const decode = stubDecoder(() => Promise.resolve(fakeAudioBuffer(24_000 * 2, 1)));
    decode.mockImplementationOnce(() => new Promise<AudioBuffer>((resolve) => (finishFirst = resolve)));

    renderAudios();
    await waitForClips();

    fireEvent.change(screen.getByTestId('audios-upload-file'), {
      target: { files: [new File([new Uint8Array(32)], 'forsta.m4a')] },
    });
    await selectFile(new File([new Uint8Array(32)], 'andra.m4a'));
    expect(text(screen.getByTestId('audios-feedback'))).toMatch(/Converted "andra.m4a": 2.0 s/);

    await act(async () => finishFirst(fakeAudioBuffer(24_000 * 5, 1)));

    expect(text(screen.getByTestId('audios-feedback'))).toMatch(/Converted "andra.m4a": 2.0 s/);
    expect((screen.getByTestId('audios-upload-title') as HTMLInputElement).value).toBe('andra');
  });

  it('refuses a compressed file too big to decode safely, before decoding it', async () => {
    const decode = stubDecoder(() => Promise.resolve(fakeAudioBuffer(24_000, 1)));

    renderAudios();
    await waitForClips();

    await selectFile(new File([new Uint8Array(MAX_COMPRESSED_SOURCE_BYTES + 1)], 'podcast.mp3'));

    expect(text(screen.getByTestId('audios-feedback'))).toMatch(
      new RegExp(`"podcast.mp3" is \\d+ bytes. Files to convert can be at most ${MAX_COMPRESSED_SOURCE_BYTES} bytes`),
    );
    expect(decode).not.toHaveBeenCalled();
  });

  it('refuses a long recording from its metadata, before decoding it', async () => {
    // A 2 MiB voice memo of ten minutes: decoding it first is what would
    // exhaust a phone's memory.
    const decode = stubDecoder(() => Promise.resolve(fakeAudioBuffer(24_000, 1)), 600);

    renderAudios();
    await waitForClips();

    await selectFile(new File([new Uint8Array(2 * 1024 * 1024)], 'hela-passet.m4a'));

    expect(text(screen.getByTestId('audios-feedback'))).toMatch(/"hela-passet.m4a" is 600.0 s long/);
    expect(decode).not.toHaveBeenCalled();
  });

  it('says a WAV is needed when the browser has no Web Audio at all', async () => {
    renderAudios();
    await waitForClips();

    await selectFile(new File([new Uint8Array(32)], 'fanfar.m4a'));

    expect(text(screen.getByTestId('audios-feedback'))).toMatch(/cannot convert audio. Upload a WAV instead/);
  });

  it('sends a clip already in the device format as it is, even where the browser could decode it', async () => {
    // Converting it again would only lose quality.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const decode = stubDecoder(() => Promise.resolve(fakeAudioBuffer(24_000, 1)));

    renderAudios();
    await waitForClips();

    const original = adpcmFile('redan-adpcm.wav');
    await selectFile(original);
    expect(text(screen.getByTestId('audios-feedback'))).toMatch(/already in the device's format/);
    fireEvent.click(screen.getByTestId('audios-upload-submit'));
    await screen.findByTestId('audios-row-1001');

    expect(decode).not.toHaveBeenCalled();
    const [, init] = uploadCalls(fetchSpy)[0] as [string, RequestInit];
    expect((init.body as FormData).get('file')).toBe(original);
  });

  it('converts a WAV too, so one too big to send as PCM fits once converted', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    stubDecoder(() => Promise.resolve(fakeAudioBuffer(24_000 * 30, 2)));

    renderAudios();
    await waitForClips();

    // 30 s of 44.1 kHz stereo PCM is over 5 MB; as 24 kHz ADPCM it is ~365 KB.
    await selectFile(wavFile('Fältskjutning.wav', MAX_UPLOAD_BYTES + 1));
    expect(text(screen.getByTestId('audios-feedback'))).toMatch(/Converted "Fältskjutning.wav": 30.0 s/);

    fireEvent.click(screen.getByTestId('audios-upload-submit'));
    await screen.findByTestId('audios-row-1001');

    const [, init] = uploadCalls(fetchSpy)[0] as [string, RequestInit];
    const sent = (init.body as FormData).get('file') as File;
    expect(sent.size).toBeLessThan(MAX_FILE_BYTES);
    expect(new DataView(await sent.arrayBuffer()).getUint16(20, true)).toBe(0x11);
  });

  it('sends a WAV the browser cannot decode as it is, and lets the device decide', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    stubDecoder(() => Promise.reject(new DOMException('Unable to decode', 'EncodingError')));

    renderAudios();
    await waitForClips();

    const original = wavFile('oklar.wav');
    await selectFile(original);
    expect(text(screen.getByTestId('audios-feedback'))).toMatch(
      /could not convert "oklar.wav", so it is sent as it is/,
    );
    fireEvent.click(screen.getByTestId('audios-upload-submit'));
    await screen.findByTestId('audios-row-1001');

    const [, init] = uploadCalls(fetchSpy)[0] as [string, RequestInit];
    expect((init.body as FormData).get('file')).toBe(original);
  });

  it('refuses a clip too long to fit once converted, saying how long is allowed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    stubDecoder(() => Promise.resolve(fakeAudioBuffer(24_000 * 90, 1)));

    renderAudios();
    await waitForClips();

    await selectFile(new File([new Uint8Array(32)], 'lang.mp3', { type: 'audio/mpeg' }));

    expect(text(await screen.findByTestId('audios-feedback'))).toMatch(
      /"lang.mp3" is 90.0 s long. A converted clip can be at most 86.\d s/,
    );
    expect((screen.getByTestId('audios-upload-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(uploadCalls(fetchSpy)).toHaveLength(0);
  });

  it("surfaces the device's own rejection of an unplayable file", async () => {
    renderAudios();
    await waitForClips();

    // A .wav name over something that is not RIFF/WAVE — exactly what the
    // firmware's `probe_wav` refuses after the file has landed.
    await selectFile(new File([new Uint8Array(32)], 'not-really.wav', { type: 'audio/wav' }));
    fireEvent.click(screen.getByTestId('audios-upload-submit'));

    const feedback = await screen.findByTestId('audios-feedback');
    expect(text(feedback)).toMatch(/Upload failed: Unsupported audio format/);

    // The form keeps what was typed, so the user can retry with another file.
    expect(screen.queryByTestId('audios-row-1001')).toBeNull();
  });

  it('adds the accepted clip to the list, id and title intact', async () => {
    renderAudios();
    await waitForClips();

    // Non-ASCII on purpose: the title crosses the wire as a multipart text
    // field, and decoding it as anything but UTF-8 mojibakes half the club's
    // clip names.
    await selectFile(wavFile('Färdiga-två.wav'));
    fireEvent.click(screen.getByTestId('audios-upload-submit'));

    // 1000 is taken by the seed, so the first free slot at or above
    // `kFirstUploadId` is 1001 — the id the firmware would assign.
    const row = await screen.findByTestId('audios-row-1001');
    expect(within(row).getByText('Färdiga-två')).toBeTruthy();
    expect(text(screen.getByTestId('audios-source-1001'))).toBe('Uploaded');
    expect(text(await screen.findByTestId('audios-feedback'))).toMatch(/Uploaded "Färdiga-två" as clip 1001/);
  });

  it('reuses the id of a deleted clip, as the device does', async () => {
    renderAudios();
    await waitForClips();

    fireEvent.click(screen.getByTestId('audios-delete-1000'));
    fireEvent.click(screen.getByTestId('audios-delete-confirm-1000'));
    await waitFor(() => expect(screen.queryByTestId('audios-row-1000')).toBeNull());

    await selectFile(wavFile('ersattning.wav'));
    fireEvent.click(screen.getByTestId('audios-upload-submit'));

    // `audios::add_uploaded` walks up from `kFirstUploadId` to the first free
    // slot, so 1000 comes back rather than the count going up.
    await screen.findByTestId('audios-row-1000');
    expect(screen.queryByTestId('audios-row-1001')).toBeNull();
  });
});

describe('play and delete', () => {
  it('confirms before deleting, then drops the row', async () => {
    renderAudios();
    await waitForClips();

    fireEvent.click(screen.getByTestId('audios-delete-1000'));
    // Nothing has left yet — the row is still there, now asking.
    expect(screen.getByTestId('audios-row-1000')).toBeTruthy();

    // Cancel comes first, so a second tap on Delete's coordinates hits it and
    // not Confirm. The row is left-aligned below 768px and right-aligned above
    // it, and Confirm is the wider of the two.
    const actions = within(screen.getByTestId('audios-row-1000')).getAllByRole('button');
    expect(actions.map((button) => button.getAttribute('data-testid'))).toEqual([
      'audios-play-1000',
      'audios-delete-cancel-1000',
      'audios-delete-confirm-1000',
    ]);

    fireEvent.click(screen.getByTestId('audios-delete-confirm-1000'));

    await waitFor(() => expect(screen.queryByTestId('audios-row-1000')).toBeNull());
    expect(text(screen.getByTestId('audios-feedback'))).toMatch(/Deleted "Klubbmästerskap 2026"/);
  });

  it('backs out of a delete on Cancel', async () => {
    renderAudios();
    await waitForClips();

    fireEvent.click(screen.getByTestId('audios-delete-1000'));
    fireEvent.click(screen.getByTestId('audios-delete-cancel-1000'));

    expect(screen.getByTestId('audios-delete-1000')).toBeTruthy();
    expect(screen.getByTestId('audios-row-1000')).toBeTruthy();
  });

  it('relays the 409 when the clip is playing, rather than swallowing it', async () => {
    renderAudios();
    await waitForClips();

    fireEvent.click(screen.getByTestId('audios-play-1000'));
    await waitFor(() => expect(text(screen.getByTestId('audios-feedback'))).toMatch(/Playing "Klubbmästerskap/));

    fireEvent.click(screen.getByTestId('audios-delete-1000'));
    fireEvent.click(screen.getByTestId('audios-delete-confirm-1000'));

    await waitFor(() =>
      expect(text(screen.getByTestId('audios-feedback'))).toMatch(
        /Could not delete "Klubbmästerskap 2026": Audio is currently playing/,
      ),
    );
    expect(screen.getByTestId('audios-row-1000')).toBeTruthy();
  });
});

describe('backend_issue', () => {
  const playbackFailed: BackendIssuePayload = {
    code: 'audio_playback_failed',
    message: 'Could not open /userdata/audio/1000.wav',
    context: { clip: '/userdata/audio/1000.wav' },
  };

  it('shows what useSSE parked in the cache, and a dismissal outlives the mount', async () => {
    renderAudios();
    await waitForClips();
    expect(screen.queryByTestId('backend-issue-banner')).toBeNull();

    // What `useSSE` does when a backend_issue frame arrives.
    backendIssueAtom.set(playbackFailed);

    const banner = await screen.findByTestId('backend-issue-banner');
    expect(text(banner)).toContain('Could not open /userdata/audio/1000.wav');
    expect(text(banner)).toContain('clip: /userdata/audio/1000.wav');

    fireEvent.click(within(banner).getByLabelText('Dismiss'));
    await waitFor(() => expect(screen.queryByTestId('backend-issue-banner')).toBeNull());

    // Leaving the page and coming back must not resurrect it: the dismissal
    // clears the cache entry rather than hiding it in component state.
    cleanup();
    renderAudios();
    await waitForClips();
    expect(screen.queryByTestId('backend-issue-banner')).toBeNull();

    // A later issue is a fresh object, so it shows again.
    backendIssueAtom.set({ ...playbackFailed, message: 'Could not configure I2S' });
    expect(text(await screen.findByTestId('backend-issue-banner'))).toContain('Could not configure I2S');
  });

  it('shows a code it has never heard of — the enum is open', async () => {
    renderAudios();
    await waitForClips();

    backendIssueAtom.set({
      code: 'storage_full',
      message: 'The uploads partition is full',
    } satisfies BackendIssuePayload);

    expect(text(await screen.findByTestId('backend-issue-banner'))).toContain('The uploads partition is full');
  });

  it('ignores an issue that is not about audio', async () => {
    renderAudios();
    await waitForClips();

    backendIssueAtom.set({
      code: 'program_invalid',
      message: 'Skipped /userdata/programs/7.json',
    } satisfies BackendIssuePayload);

    // Nothing to wait for, so let a render pass go by before asserting.
    await waitFor(() => expect(screen.getByTestId('audios-row-1')).toBeTruthy());
    expect(screen.queryByTestId('backend-issue-banner')).toBeNull();
  });
});

describe('D-24: the library changes under an open page', () => {
  /** The page as it really runs: the view plus the stream that feeds its cache. */
  function Harness(): React.ReactNode {
    useSSE();
    return <AudiosView />;
  }

  function renderWithStream(): void {
    render(
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <Harness />
        </SettingsProvider>
      </QueryClientProvider>,
    );
  }

  /**
   * An upload nothing on this page knows about - the laptop at the other end
   * of the range. It goes out over the same origin rather than through the
   * view, which is the point: no mutation hook runs, so nothing invalidates
   * the cached list except the event the device broadcasts.
   */
  async function uploadElsewhere(title: string): Promise<void> {
    const body = new FormData();
    body.append('file', wavFile(`${title}.wav`));
    body.append('title', title);
    const res = await fetch('/api/v2/audios', { method: 'POST', body });
    expect(res.status).toBe(201);
  }

  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows another client's upload without anybody reloading the page", async () => {
    renderWithStream();
    await waitForClips();

    await uploadElsewhere('Nytt klipp');
    // Still stale, exactly as #71 shipped it: the list is fetched over REST and
    // published nowhere else.
    expect(screen.queryByTestId('audios-row-1001')).toBeNull();

    act(() => {
      expect(FakeEventSource.latest.emit('libraryChanged', { kind: 'audio' })).toBe(true);
    });

    await waitFor(() => expect(screen.getByTestId('audios-row-1001')).toBeTruthy());
    expect(text(screen.getByTestId('audios-row-1001'))).toContain('Nytt klipp');
  });

  it('leaves the clip list alone when it is the program library that changed', async () => {
    renderWithStream();
    await waitForClips();

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    act(() => {
      FakeEventSource.latest.emit('libraryChanged', { kind: 'program' });
      // Nor does run state touch it: load, start, stop and unload are
      // stateUpdates, and none of them changes what the device stores.
      FakeEventSource.latest.emit('stateUpdate', {
        loadedProgramId: null,
        programState: null,
        targetBanks: { A: 'hidden' },
      });
    });

    // A render pass to be wrong in, and then nothing was re-read.
    await waitFor(() => expect(screen.getByTestId('audios-row-1')).toBeTruthy());
    expect(fetchSpy.mock.calls.filter((call) => String(call[0]).endsWith('/api/v2/audios'))).toHaveLength(0);
  });
});
