// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real - the firmware serves
// the bundle. See the note in useControlLockStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18102" }
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateSection } from '../src/components/UpdateSection';
import { SettingsProvider } from '../src/context/SettingsContext';
import { RELEASE_REPO } from '../src/lib/release-check';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, fakeFirmwareImage, type MockServer } from './mock-server/server';

const PORT = 18102;

let server: MockServer;
let queryClient: QueryClient;

/** What a release's `-ota.bin` holds in these tests: an image the mock accepts. */
const IMAGE = fakeFirmwareImage();
const IMAGE_SHA256 = bytesToHex(sha256(new Uint8Array(IMAGE)));

function release(tag: string, extra: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    body: `## What changed in ${tag}\n\n- something [linked](https://example.com/${tag})`,
    published_at: '2026-10-06T08:57:31Z',
    prerelease: false,
    draft: false,
    html_url: `https://github.com/${RELEASE_REPO}/releases/tag/${tag}`,
    assets: [
      {
        name: `revolve_now-${tag}-ota.bin`,
        browser_download_url: `https://github.com/${RELEASE_REPO}/releases/download/${tag}/revolve_now-${tag}-ota.bin`,
        size: IMAGE.byteLength,
        digest: `sha256:${IMAGE_SHA256}`,
      },
    ],
    ...extra,
  };
}

async function device(firmwareVersion: string): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: {}, audios: [], firmwareVersion },
  });
  await server.listen();
}

/** GitHub's releases API answering `answer`; everything else goes to the mock. */
function github(answer: unknown[] | 'unreachable' | 'rate-limited'): void {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.github.com/')) return realFetch(input, init);
    if (answer === 'unreachable') return Promise.reject(new TypeError('Failed to fetch'));
    if (answer === 'rate-limited') {
      return Promise.resolve(new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }));
    }
    return Promise.resolve(new Response(JSON.stringify(answer)));
  });
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <UpdateSection />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

async function status(): Promise<string> {
  await waitFor(() => expect(screen.getByTestId('update-check-status').textContent).not.toMatch(/^Checking/));
  // The device's version arrives on its own query; wait for it rather than "unavailable".
  await waitFor(() => expect(screen.getByTestId('update-check-status').textContent).not.toContain('navailable'));
  return screen.getByTestId('update-check-status').textContent ?? '';
}

function pick(testId: string, bytes: Uint8Array<ArrayBuffer>, name: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { files: [new File([bytes], name)] } });
}

beforeEach(() => {
  localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  // A query still in flight when the server closes is logged as ECONNRESET.
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  vi.restoreAllMocks();
  cleanup();
  queryClient.clear();
  await server.close();
});

describe('checking GitHub', () => {
  it('checks on opening and offers the newer release with its notes', async () => {
    await device('0.1.0');
    github([release('0.1.0'), release('0.2.0')]);
    renderSection();

    expect(await status()).toBe('Version 0.2.0 is available. This device runs 0.1.0.');
    expect(screen.getByTestId('update-last-checked').textContent).toMatch(
      /^Last checked \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
    expect((screen.getByTestId('update-version') as HTMLSelectElement).value).toBe('0.2.0');
    // The notes renderer is loaded on demand.
    expect(await screen.findByRole('heading', { name: 'What changed in 0.2.0' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'linked' }).getAttribute('target')).toBe('_blank');

    const download = screen.getByTestId('update-download');
    expect(download.getAttribute('href')).toBe(
      `https://github.com/${RELEASE_REPO}/releases/download/0.2.0/revolve_now-0.2.0-ota.bin`,
    );
    expect(download.getAttribute('download')).toBe('revolve_now-0.2.0-ota.bin');
  });

  it('says the device is up to date, and offers a reinstall', async () => {
    await device('0.2.0');
    github([release('0.2.0')]);
    renderSection();

    expect(await status()).toBe('This device runs the latest version, 0.2.0.');
    expect(screen.getByTestId('update-install').textContent).toBe('2. Reinstall from the downloaded file…');
  });

  it('says plainly when this browser cannot reach GitHub, and keeps the file upload', async () => {
    await device('0.1.0');
    github('unreachable');
    renderSection();

    expect(await status()).toBe(
      "This phone or computer can't reach GitHub, so updates can't be checked from here. You can still upload an OTA file below.",
    );
    expect(screen.queryByTestId('update-version')).toBeNull();
    // A failed check still says when it was made.
    expect(screen.getByTestId('update-last-checked')).toBeTruthy();
    expect(screen.getByTestId('update-upload')).toBeTruthy();
  });

  it('says so when GitHub refuses for the rate limit', async () => {
    await device('0.1.0');
    github('rate-limited');
    renderSection();

    expect(await status()).toMatch(/^GitHub is refusing more checks/);
  });

  it('hides pre-releases until asked', async () => {
    await device('0.1.0');
    github([release('0.1.0'), release('0.3.0', { prerelease: true })]);
    renderSection();
    await status();

    const options = () => [...screen.getByTestId('update-version').querySelectorAll('option')].map((o) => o.value);
    expect(options()).toEqual(['0.1.0']);
    fireEvent.click(screen.getByTestId('update-prereleases'));
    expect(options()).toEqual(['0.3.0', '0.1.0']);
  });

  it('lists a release with no OTA file but does not offer to install it', async () => {
    await device('0.1.0');
    github([release('0.2.0', { assets: [] })]);
    renderSection();
    await status();

    expect(screen.getByTestId('update-not-installable')).toBeTruthy();
    expect(screen.queryByTestId('update-install')).toBeNull();
  });
});

describe('installing a release', () => {
  it('uploads the downloaded file once it matches the published checksum', async () => {
    await device('0.1.0');
    github([release('0.2.0')]);
    renderSection();
    await status();

    pick('update-github-file', new Uint8Array(IMAGE), 'revolve_now-0.2.0-ota.bin');
    expect((await screen.findByTestId('update-notice')).textContent).toBe(
      'Update installed. The device is restarting — it will be unreachable for a few seconds.',
    );
  });

  it('refuses a file that is not the published one, without uploading it', async () => {
    await device('0.1.0');
    github([release('0.2.0')]);
    renderSection();
    await status();
    const fetchSpy = vi.mocked(globalThis.fetch);

    pick('update-github-file', new Uint8Array(fakeFirmwareImage('revolve_now', 8192)), 'revolve_now-0.2.0-ota.bin');
    expect((await screen.findByTestId('update-notice')).textContent).toBe(
      'That file is not revolve_now-0.2.0-ota.bin as published on GitHub — its checksum is different. Choose the file you downloaded in step 1.',
    );
    expect(fetchSpy.mock.calls.some(([input]) => String(input).endsWith('/api/v2/ota'))).toBe(false);
  });

  it('warns before a downgrade, including below the first version with this page', async () => {
    await device('0.2.0');
    github([release('0.2.0'), release('0.1.0')]);
    renderSection();
    await status();

    fireEvent.change(screen.getByTestId('update-version'), { target: { value: '0.1.0' } });
    expect(screen.getByTestId('update-downgrade-warning').textContent).toMatch(/^0\.1\.0 is older than/);

    fireEvent.click(screen.getByTestId('update-install'));
    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog.textContent).toContain('Downgrade to 0.1.0?');
    expect(dialog.textContent).toContain('0.1.0 also has no update check.');
  });
});
