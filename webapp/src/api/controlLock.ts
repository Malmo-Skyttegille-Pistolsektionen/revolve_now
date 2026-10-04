import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient } from './client';

export interface ControlLockStatusResponse {
  enabled: boolean;
}

export interface ControlLockEnableResponse {
  token: string;
}

export function useControlLockApi() {
  const { controlLockToken, logoutControlLock } = useSettings();
  const { request } = createAuthenticatedClient(controlLockToken, logoutControlLock);

  return {
    fetchStatus: (): Promise<ControlLockStatusResponse> => {
      return request<ControlLockStatusResponse>('/control-lock/status');
    },

    enable: (password: string): Promise<ControlLockEnableResponse> => {
      return request<ControlLockEnableResponse>('/control-lock/enable', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
    },

    login: (password: string): Promise<ControlLockEnableResponse> => {
      return request<ControlLockEnableResponse>('/control-lock/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
    },

    disable: (): Promise<void> => {
      return request<void>('/control-lock/disable', {
        method: 'POST',
      });
    },
  };
}
