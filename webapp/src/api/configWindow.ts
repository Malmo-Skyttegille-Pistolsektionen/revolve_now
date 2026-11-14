import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient } from './client';
import type { ConfigWindowRequest, ConfigWindowStatus } from './types';

/**
 * The configuration window, bound to the client that asked for it (D-52): ask
 * with `request`, then somebody presses BOOT three times. `status` says where
 * this browser stands, for the token it holds.
 */
export function useConfigWindowApi() {
  const { controlLockToken, logoutControlLock, configWindowToken } = useSettings();
  const client = createAuthenticatedClient(controlLockToken, logoutControlLock, configWindowToken);

  return {
    status: (): Promise<ConfigWindowStatus> => client.request<ConfigWindowStatus>('/config-window'),
    request: (): Promise<ConfigWindowRequest> =>
      client.request<ConfigWindowRequest>('/config-window/request', { method: 'POST' }),
  };
}
