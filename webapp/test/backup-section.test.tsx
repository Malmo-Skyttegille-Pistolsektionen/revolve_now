// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real. See the note in
// useControlLockStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18232" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackupSection } from '../src/components/BackupSection';
import { SettingsProvider } from '../src/context/SettingsContext';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';
import { writeStoredZip, type ZipEntry } from './mock-server/zip';
import { enableControlLockElsewhere } from './other-client';

// Distinct per suite - vitest runs files in parallel.
const PORT = 18232;

let server: MockServer;
let queryClient: QueryClient;
let saved: { filename: string; blob: Blob }[];

async function device(configWindowOpen = true): Promise<void> {
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
        <BackupSection />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

function backupJson(hardware?: Record<string, unknown>): ZipEntry {
  return {
    name: 'backup.json',
    data: Buffer.from(
      JSON.stringify({
        format: 'revolve-now-backup',
        formatVersion: 1,
        firmwareVersion: '0.1.0',
        hostname: 'range-a',
        displayName: '',
        includesWifiCredentials: false,
        ...(hardware ? { hardware } : {}),
        audios: [],
      }),
    ),
  };
}
const BACKUP_JSON = backupJson();

function choose(entries: ZipEntry[] | string): void {
  const bytes = typeof entries === 'string' ? Buffer.from(entries) : writeStoredZip(entries);
  const file = new File([new Uint8Array(bytes)], 'backup.zip', { type: 'application/zip' });
  fireEvent.change(screen.getByTestId('backup-file-input'), { target: { files: [file] } });
}

beforeEach(() => {
  localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  saved = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    saved.push({ filename: '', blob: blob as Blob });
    return 'blob:backup';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (saved.length > 0) saved[saved.length - 1].filename = this.download;
  });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  queryClient.unmount();
  queryClient.clear();
  await server.close();
});

describe('the backup section', () => {
  it('downloads the device’s archive under its name, dated here', async () => {
    await device();
    renderSection();

    fireEvent.click(await screen.findByTestId('backup-download'));

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0].filename).toMatch(/^revolve-now-backup-2\.0\.0-mock-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(screen.getByTestId('backup-notice').textContent).toBe('Downloaded.');
  });

  it('reports what a restore added', async () => {
    await device();
    renderSection();

    choose([BACKUP_JSON, { name: 'programs/1000.json', data: Buffer.from('{"title":"Restored","series":[]}') }]);

    const report = await screen.findByTestId('backup-report');
    expect(report.textContent).toContain('Restored from range-a, firmware 0.1.0.');
    expect(screen.getByTestId('backup-report-programs').textContent).toBe('Programs: 1 added');
    expect(screen.getByTestId('backup-report-hardware').textContent).toBe('The backup holds no hardware settings.');
  });

  it('says why the hardware was skipped, with the device’s own sentence', async () => {
    await device(false);
    renderSection();

    // Offered anyway, with the reason it will be skipped.
    expect(await screen.findByTestId('backup-window-hint')).toBeTruthy();
    choose([backupJson({ i2sMclkGpio: 3 })]);

    const line = await screen.findByTestId('backup-report-hardware');
    expect(line.textContent).toContain('Hardware settings were not restored:');
    expect(line.textContent).toContain('three times within ten seconds');
  });

  it('sends the name only when asked, and only with the hardware', async () => {
    await device();
    renderSection();

    const name = (await screen.findByTestId('backup-restore-name')) as HTMLInputElement;
    expect(name.checked).toBe(false);
    fireEvent.click(name);
    expect(name.checked).toBe(true);

    fireEvent.click(screen.getByTestId('backup-restore-hardware'));
    expect(name.disabled).toBe(true);
    expect(name.checked).toBe(false);
  });

  it('shows the device’s refusal of a file that is not a backup', async () => {
    await device();
    renderSection();

    choose('not a zip');

    const notice = await screen.findByTestId('backup-notice');
    expect(notice.textContent).toBe('Not a backup: the file is not a ZIP archive.');
  });

  it('lists every refused item with its reason', async () => {
    await device();
    renderSection();

    choose([BACKUP_JSON, { name: 'audio/1000.wav', data: Buffer.from('nope') }]);

    const refused = await screen.findByTestId('backup-report-refused');
    expect(refused.textContent).toBe('Restored clip 1000: Not a WAV this firmware can play.');
  });

  it('offers no restore to somebody who is locked out', async () => {
    await device();
    await enableControlLockElsewhere(PORT, 'secret');
    renderSection();

    await waitFor(() => {
      expect((screen.getByTestId('backup-restore') as HTMLButtonElement).disabled).toBe(true);
    });
    expect(screen.getByText('Log in to restore a backup.')).toBeTruthy();
    // Reading is not a write: the download stays.
    expect((screen.getByTestId('backup-download') as HTMLButtonElement).disabled).toBe(false);
  });
});
