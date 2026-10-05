import { createAtom } from '@tanstack/react-store';
import type { BackendIssuePayload, StateUpdatePayload } from '../api/types';

/**
 * What the event stream last said, held where a read is synchronous and cannot
 * be batched, rather than as placeholder queries in the TanStack Query cache.
 * `useSSE` is the only writer; views read with `useSelector`, and the one
 * imperative read (`refuseStart`) calls `.get()` and sees a frame the moment
 * it lands.
 */

/** The latest `stateUpdate`; null until the first frame. */
export const stateAtom = createAtom<StateUpdatePayload | null>(null);

/** Whether the stream is up; null until it first opens. */
export const sseStatusAtom = createAtom<'connected' | 'error' | null>(null);

/** The last `backend_issue`. Fire-and-forget by contract, so a dismissal sets it back to null. */
export const backendIssueAtom = createAtom<BackendIssuePayload | null>(null);

/** For tests: the atoms are module singletons, so state would leak between cases. */
export function resetSseAtoms(): void {
  stateAtom.set(null);
  sseStatusAtom.set(null);
  backendIssueAtom.set(null);
}
