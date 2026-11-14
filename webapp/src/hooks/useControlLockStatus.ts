import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSettings } from '../context/SettingsContext';
import { useControlLockApi } from '../api/controlLock';

export function useControlLockStatus() {
  const { setControlLockToken, logoutControlLock } = useSettings();
  const controlLockApi = useControlLockApi();
  const queryClient = useQueryClient();

  // Always fetch the lock's state from the device - single source of truth
  const { data: controlLockStatus, isLoading } = useQuery({
    queryKey: ['control-lock-status'],
    queryFn: controlLockApi.fetchStatus,
    staleTime: 0, // Always fetch fresh data
    refetchOnWindowFocus: true,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const controlLockEnabled = controlLockStatus?.enabled ?? false;

  // Enable mutation
  const enableMutation = useMutation({
    mutationFn: (password: string) => controlLockApi.enable(password),
    onSuccess: (data) => {
      setControlLockToken(data.token);
      void queryClient.invalidateQueries({ queryKey: ['control-lock-status'] });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['control-lock-status'] });
    },
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: (password: string) => controlLockApi.login(password),
    onSuccess: (data) => {
      setControlLockToken(data.token);
      void queryClient.invalidateQueries({ queryKey: ['control-lock-status'] });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['control-lock-status'] });
    },
  });

  // Turn the lock off
  const disableMutation = useMutation({
    mutationFn: () => controlLockApi.disable(),
    onSuccess: () => {
      logoutControlLock();
      void queryClient.invalidateQueries({ queryKey: ['control-lock-status'] });
    },
  });

  // Log out: end this session on the device, then drop the token here. The
  // token is dropped even if the device cannot be reached - a client that
  // stays logged in because the network blipped would be worse - but a
  // dropped token alone stays valid on the device until it expires, and the
  // cookie keeps authorising this browser.
  const logoutMutation = useMutation({
    mutationFn: () => controlLockApi.logout(),
    onSettled: () => {
      logoutControlLock();
      void queryClient.invalidateQueries({ queryKey: ['control-lock-status'] });
    },
  });

  async function logout(): Promise<void> {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Already handled in onSettled: the local token is gone either way.
    }
  }

  return {
    controlLockEnabled,
    isLoading,
    enable: enableMutation.mutateAsync,
    login: loginMutation.mutateAsync,
    disable: disableMutation.mutateAsync,
    logout,
    isEnablePending: enableMutation.isPending,
    isLoginPending: loginMutation.isPending,
    isDisablePending: disableMutation.isPending,
    isLogoutPending: logoutMutation.isPending,
  };
}
