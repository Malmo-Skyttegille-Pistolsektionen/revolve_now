import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient } from './client';
import type { EthernetStatus } from './types';

/** The wired interface (#262): public and cheap, read-only like `GET /wifi`. */
export function useEthernetApi() {
  const { controlLockToken, logoutControlLock } = useSettings();
  const client = createAuthenticatedClient(controlLockToken, logoutControlLock);

  return {
    status: (): Promise<EthernetStatus> => client.request<EthernetStatus>('/ethernet'),
  };
}
