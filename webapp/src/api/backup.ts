import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient, type DownloadedFile } from './client';
import type { RestoreReport } from './types';

export interface RestoreOptions {
  /** Restore the hardware configuration. Needs the configuration window. */
  hardware: boolean;
  /** Restore the hostname and display name too. */
  name: boolean;
}

/**
 * `GET /backup` and `POST /restore` (#520). The device builds and reads the
 * archive; this side only moves the file and shows what the device reports.
 */
export function useBackupApi() {
  const { controlLockToken, logoutControlLock } = useSettings();
  const client = createAuthenticatedClient(controlLockToken, logoutControlLock);

  return {
    download: (): Promise<DownloadedFile> => client.requestFile('/backup'),

    restore: (file: File, options: RestoreOptions): Promise<RestoreReport> => {
      const body = new FormData();
      body.append('file', file);
      const query = new URLSearchParams({ hardware: String(options.hardware), name: String(options.name) });
      return client.request<RestoreReport>(`/restore?${query.toString()}`, { method: 'POST', body });
    },
  };
}
