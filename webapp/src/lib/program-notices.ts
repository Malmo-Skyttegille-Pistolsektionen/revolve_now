/**
 * What the programs tab and the editor say when a call to the device fails.
 *
 * Shared because both of them make the same three writes — create, replace,
 * load — and the refusals that need explaining are the same refusals. The
 * `PUT` 409 in particular is a paragraph of context (D-15) that must not exist
 * in two versions that can drift apart.
 */
import { problemType } from '../api/client';
import type { Messages } from '../i18n';
import type { DocumentIssue } from './program-document';

/** The `programs.notices` dictionary, passed in because this module is not a component. */
type NoticeMessages = Messages['programs']['notices'];

export interface Notice {
  kind: 'error' | 'success' | 'warning';
  message: string;
  /** One line per point; used for the per-field validation output. */
  details?: string[];
  action?: { label: string; run: () => void };
}

export function issueLines(issues: DocumentIssue[]): string[] {
  return issues.map((issue) => `${issue.path || '/'} — ${issue.message}`);
}

/**
 * Turn a rejected call into something a club member can act on. The device's
 * own `detail` is the fallback, but the ones that need context get it here.
 *
 * Every branch below keys off the problem `type` (D-19), never off the
 * wording: `detail` is display text and the contract says so. A `type` this
 * app does not know falls through to showing `detail`, which is what the
 * contract asks a client to do.
 */
export function failureNotice(t: NoticeMessages, err: unknown, prefix: string): Notice {
  if (problemType(err) === '/problems/control_lock_credentials_required') {
    return { kind: 'error', message: `${prefix} ${t.lockedNotSignedIn}` };
  }
  return { kind: 'error', message: `${prefix} ${err instanceof Error ? err.message : String(err)}` };
}

export function updateFailureNotice(t: NoticeMessages, err: unknown, id: number): Notice {
  switch (problemType(err)) {
    case '/problems/program_readonly':
      return { kind: 'error', message: t.readonly(id) };
    // D-15: run state holds a pointer into the stored program, so the device
    // refuses. D-22 gave that refusal an escape of its own - before
    // `POST /programs/unload` existed the only ways out were loading some other
    // program or deleting this one, and this notice had to say so.
    case '/problems/program_loaded':
      return { kind: 'error', message: t.loaded(id) };
    case '/problems/program_not_found':
      return { kind: 'error', message: t.gone(id) };
  }
  return failureNotice(t, err, t.replaceFailed(id));
}

/**
 * A read of a program answered 404: the device does not have it any more.
 * Deleted from another browser, or by a delete on this one that the editor was
 * not part of.
 */
export function isGoneFromDevice(err: unknown): boolean {
  return problemType(err) === '/problems/program_not_found';
}

/**
 * The editor could not re-read the document it has open. D-24 made that
 * reachable mid-edit: `libraryChanged` invalidates `['program', id]` under an
 * open editor, and the ordinary reason for the event is another client
 * deleting or replacing that very program.
 *
 * The draft is never the casualty, so both branches say so; they differ in
 * what Save will do next, which is decided by whether the program still
 * exists. `PUT /programs/{id}` on an id the device does not have answers 404 —
 * it does not re-create — so on a 404 the editor sends `POST` instead and this
 * says as much rather than promising a replace that cannot happen.
 */
export function sourceReloadNotice(t: NoticeMessages, err: unknown, id: number): Notice {
  if (isGoneFromDevice(err)) {
    return { kind: 'warning', message: t.deletedWhileOpen(id) };
  }
  return { kind: 'warning', message: t.reloadFailed(id, err instanceof Error ? err.message : String(err)) };
}

/**
 * `POST /programs/unload`. The only refusal it has is a run in progress
 * (D-22): unloading is bookkeeping and must not end a series mid-range, so the
 * device says stop first rather than stopping on the client's behalf. The
 * escape is one button away, and the wording has to name it for a reader on
 * the programs tab without telling a reader on the Run page to go where they
 * already are.
 *
 * That single refusal is also why this one does not sniff the message the way
 * `updateFailureNotice` has to: `PUT` answers 409 for two different reasons
 * and only the text tells them apart, while unload has exactly one.
 */
export function unloadFailureNotice(t: NoticeMessages, err: unknown): Notice {
  if (problemType(err) === '/problems/program_running') {
    return { kind: 'error', message: t.unloadWhileRunning };
  }
  return failureNotice(t, err, t.unloadFailed);
}
