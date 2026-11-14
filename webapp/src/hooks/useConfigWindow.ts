import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfigWindowApi } from '../api/configWindow';
import type { ConfigWindowState, ConfigWindowStatus } from '../api/types';
import { useSettings } from '../context/SettingsContext';

export interface ConfigWindow {
  /** Whether this browser holds the window, so the device accepts its writes. */
  open: boolean;
  state: ConfigWindowState;
  /** Of the window while open, of the request while pending. */
  remainingSeconds: number;
  /** Asks for the window; three presses of BOOT then open it for this browser. */
  request: () => void;
  requesting: boolean;
  /** Why the last request failed, if it did. */
  requestError: unknown;
}

/**
 * Where this browser stands with the configuration window (#144, D-52).
 *
 * The window belongs to one client: this browser asks, gets a token, and three
 * presses of BOOT open the window for that token alone - or for nobody, when
 * another client asked at the same time. The token is kept in settings and
 * sent with every call the window guards.
 *
 * Fetched once and then refetched on each `configWindow` SSE event, which
 * `useSSE` turns into an invalidation: the event says a window opened or
 * closed for somebody, and only this query says whether that was us. Polled
 * only while a request waits for the presses, as a backstop to the event.
 */
export function useConfigWindow(): ConfigWindow {
  const api = useConfigWindowApi();
  const { configWindowToken, setConfigWindowToken } = useSettings();
  const queryClient = useQueryClient();

  const { data, dataUpdatedAt } = useQuery({
    queryKey: ['config-window', configWindowToken],
    queryFn: api.status,
    refetchInterval: (query) => (query.state.data?.state === 'pending' ? 2000 : false),
  });

  const mutation = useMutation({
    mutationFn: api.request,
    onSuccess: ({ token, ...status }) => {
      queryClient.setQueryData<ConfigWindowStatus>(['config-window', token], status);
      setConfigWindowToken(token);
    },
  });

  const state = data?.state ?? 'closed';
  const counting = state === 'open' || state === 'pending';
  const serverRemaining = data?.remainingSeconds ?? 0;

  // A countdown that only moves when the device answers jumps and reads as a
  // broken clock. This re-renders once a second; the value is derived from
  // when the device last answered, so there is no second copy of the truth.
  // The clock is sampled in the interval rather than during render, so the
  // output does not depend on when React happened to render.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [counting]);

  const elapsedSeconds = nowMs > 0 && dataUpdatedAt > 0 ? Math.max(0, Math.floor((nowMs - dataUpdatedAt) / 1000)) : 0;

  return {
    // The device decides whether the window is open - never the local clock.
    // Showing the form as usable because a browser-side counter has not run
    // out yet would be a form that looks fine and cannot save.
    open: state === 'open',
    state,
    remainingSeconds: Math.max(0, serverRemaining - elapsedSeconds),
    request: () => {
      mutation.mutate();
    },
    requesting: mutation.isPending,
    requestError: mutation.error,
  };
}
