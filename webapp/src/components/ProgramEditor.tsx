import { useMemo, useReducer, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAudiosApi } from '../api/audios';
import { useProgramsApi } from '../api/programs';
import type { AudioFile, Program } from '../api/types';
import {
  authoringIssues,
  authoringRegressions,
  parseProgramDocument,
  type AuthoringIssue,
  type DocumentIssue,
} from '../lib/program-document';
import {
  createEditorState,
  describeEvent,
  durationMs,
  editorReducer,
  isDirty,
  seriesMs,
  toJson,
  toPreviewProgram,
  type DraftCommand,
  type DraftEvent,
  type DraftSeries,
  type EditorAction,
} from '../lib/program-editor';
import { BANK_LETTERS, type BankLetter } from '../lib/program-document';
import { useT } from '../i18n';
import {
  failureNotice,
  isGoneFromDevice,
  issueLines,
  sourceReloadNotice,
  updateFailureNotice,
  type Notice,
} from '../lib/program-notices';
import { ConfirmDialog } from './ConfirmDialog';
import { NoticeBanner } from './NoticeBanner';
import { Timeline } from './Timeline';
import { downloadJson, programFilename } from '../lib/download';
import styles from './ProgramEditor.module.css';

/**
 * What the session is for. `copy` and `edit` both need the full document —
 * `GET /programs` returns summaries — so both are fetched before the form
 * opens; `new` starts from nothing.
 *
 * `standalone` is the Pages build's only target (#140): there is no device to
 * fetch from or save to, so the document arrives already in hand — from a
 * repo file, a local file, or empty — and `id` is chosen by whoever opened it
 * rather than assigned by a `POST`. `origin` is one line of "where this came
 * from", carried through to the pull request body.
 */
export type EditorTarget =
  | { kind: 'new' }
  | { kind: 'copy'; sourceId: number; sourceTitle: string }
  | { kind: 'edit'; id: number }
  | {
      kind: 'standalone';
      id: number;
      document: Program | null;
      /** Where the document came from, for the pull-request body: English, like the rest of it. */
      origin: string;
      /** The same, as the page shows it. */
      originLabel: string;
    };

interface ProgramEditorProps {
  target: EditorTarget;
  onClose: () => void;
  /** A `POST` succeeded: the device assigned this id, and the editor is done. */
  onCreated: (id: number, title: string) => void;
  /**
   * Rendered in place of a device save when `target.kind === 'standalone'`
   * (#140) - a validated document ready to download or send back as a pull
   * request. A render prop, not an import of `./ExportPanel` here: the
   * device build never has a reason to reach that component or the
   * GitHub/pull-request code behind it, so this keeps the device bundle from
   * ever containing them - see webapp/README.md's note on the size budget.
   * Only `src/standalone/StandaloneEditorApp.tsx` supplies it; the device
   * build (`src/routes/programs.tsx`) never does, and never needs to, since
   * `target.kind` is never `'standalone'` there.
   */
  renderExport?: (props: { program: Program; origin: string; onClose: () => void }) => React.ReactNode;
  /**
   * Where to get the clip catalogue when there is no device (#140). Injected
   * for the same reason as `renderExport`: only the Pages build has a source
   * for this - the repository - and the device build must not carry the
   * GitHub-fetching code to reach it. Without one, a deviceless editor shows
   * every clip as a bare id, which is what it did before.
   */
  loadAudios?: () => Promise<AudioFile[]>;
}

/**
 * The WYSIWYG program editor: everything the legacy editor's five view tabs
 * did, over one document.
 *
 * Form, Events and Timeline were three renderings of the same edit operations
 * in the legacy app, each with its own copy of the reorder, selection and
 * context-menu code (#73). Here there is one structured editor — with the
 * Events view's cross-series selection and batch delete folded into it — plus
 * the JSON the device will actually receive, and the read-only timeline
 * underneath both as a preview.
 */
export function ProgramEditor({
  target,
  onClose,
  onCreated,
  renderExport,
  loadAudios,
}: ProgramEditorProps): React.ReactNode {
  const t = useT();
  const programsApi = useProgramsApi();
  // `standalone` already holds its document - see the type doc above - so it
  // takes the `new` branch here too: no device fetch, ever.
  const sourceId =
    target.kind === 'new' || target.kind === 'standalone' ? null : target.kind === 'copy' ? target.sourceId : target.id;

  const {
    data: source,
    isPending,
    error,
  } = useQuery({
    queryKey: ['program', sourceId],
    queryFn: () => programsApi.get(sourceId as number),
    enabled: sourceId !== null,
    staleTime: Infinity,
  });

  if (sourceId !== null && isPending) {
    return (
      <section className={styles.editor} data-testid='program-editor'>
        <p className={styles.message}>{t.editor.loading(sourceId)}</p>
      </section>
    );
  }

  // `source === undefined` is what separates the two failures. Only the first
  // load has nothing to show, and only it may replace the form: react-query
  // keeps `data` through a *background* failure and still reports
  // `status: 'error'`, so unmounting on `error` alone threw an open draft away
  // the moment a refetch failed - past both the discard confirm and the
  // navigation blocker, in silence. D-24 is what made that reachable:
  // `libraryChanged` invalidates `['program', id]` under an open editor, and
  // its ordinary cause is another client deleting the program being edited.
  if (error && source === undefined && sourceId !== null) {
    return (
      <section className={styles.editor} data-testid='program-editor'>
        <p className={styles.message}>{t.editor.openFailed(sourceId, error.message)}</p>
        <button className={styles.button} onClick={onClose}>
          {t.editor.close}
        </button>
      </section>
    );
  }

  // Keyed on the source so a second Edit on another row rebuilds the reducer
  // rather than reusing the first program's draft.
  return (
    <ProgramEditorForm
      key={`${target.kind}-${sourceId ?? 'new'}`}
      target={target}
      source={target.kind === 'standalone' ? target.document : (source ?? null)}
      sourceError={source === undefined ? null : error}
      onClose={onClose}
      onCreated={onCreated}
      renderExport={renderExport}
      loadAudios={loadAudios}
    />
  );
}

interface FormProps extends ProgramEditorProps {
  source: Program | null;
  /** A refetch of `source` that failed with the loaded document still in hand. */
  sourceError: Error | null;
}

type Tab = 'editor' | 'json';

/** Both tabs render into one panel, so both `aria-controls` point at it. */
const TAB_PANEL_ID = 'editor-tabpanel';

/** A validated document waiting on the author to see what will happen to it. */
interface PendingSave {
  program: Program;
  /** The device will store these differently from what was typed. */
  warnings: DocumentIssue[];
  /** Authoring problems the stored program already had (`authoringRegressions`). */
  carried: AuthoringIssue[];
}

function ProgramEditorForm({
  target,
  source,
  sourceError,
  onClose,
  onCreated,
  renderExport,
  loadAudios,
}: FormProps): React.ReactNode {
  const t = useT();
  const queryClient = useQueryClient();
  const programsApi = useProgramsApi();
  const audiosApi = useAudiosApi();
  // The Pages build (#140): no device to save to, an id chosen at open time
  // instead of assigned by `POST`, and no audio list to fetch either.
  const deviceless = target.kind === 'standalone';

  const [state, dispatch] = useReducer(editorReducer, source, (program: Program | null) =>
    createEditorState(
      // A copy carries the shipped document's content and none of its identity:
      // the title says so, because two rows reading "Fältträning" with only the
      // Shipped badge between them is the accident waiting to happen.
      program !== null && target.kind === 'copy'
        ? { ...program, title: `${program.title}${t.editor.copySuffix}` }
        : program,
    ),
  );
  const [tab, setTab] = useState<Tab>('editor');
  const [json, setJson] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** A validated document ready to download or open as a pull request (deviceless only). */
  const [exportProgram, setExportProgram] = useState<Program | null>(null);

  // Two sources for one list. With a device it is `GET /audios`, which knows
  // about uploaded clips as well as shipped ones. Without one it is whatever
  // `loadAudios` can find - the repository's shipped catalogue - so a clip can
  // still be named. A failure is not surfaced: the ids alone are what this
  // showed before, so falling back to them costs nothing an operator can act
  // on, and the editor is usable either way.
  const { data: audios } = useQuery({
    queryKey: ['audios', deviceless ? 'repo' : 'device'],
    queryFn: deviceless && loadAudios ? loadAudios : audiosApi.list,
    enabled: !deviceless || loadAudios !== undefined,
    retry: false,
  });

  // Unapplied JSON is an edit like any other. `isDirty` only sees the draft,
  // and the JSON view holds its text until a tab switch or a save applies it —
  // so without this half, typing into the JSON tab and closing the editor threw
  // the work away in silence, while `handleSave` treated the very same text as
  // the real document.
  const dirty = isDirty(state) || (json !== null && json !== toJson(state.draft));

  // Navigating away from the tab drops the draft, and the legacy editor's
  // Cancel did it without a word. `enableBeforeUnload` covers closing the tab.
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  const createMutation = useMutation({
    mutationFn: (program: Program) => programsApi.create(program),
    onSuccess: (created, program) => {
      void queryClient.invalidateQueries({ queryKey: ['programs'] });
      onCreated(created.id, program.title);
    },
    onError: (err, program) => setNotice(failureNotice(t.programs.notices, err, t.editor.saveFailed(program.title))),
  });

  const updateMutation = useMutation({
    mutationFn: (upload: { id: number; program: Program }) => programsApi.update(upload.id, upload.program),
    onSuccess: (stored, upload) => {
      void queryClient.invalidateQueries({ queryKey: ['programs'] });
      void queryClient.invalidateQueries({ queryKey: ['program', upload.id] });
      // The response is what the device stored, so the draft becomes that
      // rather than what was sent — and is clean against it.
      dispatch({ type: 'saved', program: stored });
      setJson(null);
      setNotice({ kind: 'success', message: t.editor.saved(upload.id, stored.title) });
    },
    // Left open on purpose: a 409 means the save has to be retried after
    // loading something else, and closing would throw the edits away.
    onError: (err, upload) => setNotice(updateFailureNotice(t.programs.notices, err, upload.id)),
  });

  const busy = createMutation.isPending || updateMutation.isPending;

  // A `copy` seeds a new program either way, so a failed re-read of its source
  // changes nothing; only an `edit` has a target that can stop existing.
  const staleSource =
    target.kind === 'edit' && sourceError !== null
      ? sourceReloadNotice(t.programs.notices, sourceError, target.id)
      : null;
  // Save has to become a create: `PUT` on an id the device does not hold is a
  // 404, so the alternative is an editor whose only button is guaranteed to
  // fail. The banner above says this is what will happen; the button says
  // "Create" so it is not read as a replace.
  const sourceGone = target.kind === 'edit' && isGoneFromDevice(sourceError);

  /** The JSON view's text: the draft, unless the user has typed over it. */
  const jsonText = json ?? toJson(state.draft);
  // Once per keystroke rather than once per render: the textarea re-renders the
  // whole editor, and the whole document is re-parsed to answer it.
  const jsonResult = useMemo(() => (tab === 'json' ? parseProgramDocument(jsonText) : null), [tab, jsonText]);

  /**
   * Pull the JSON view's text back into the document, the way the legacy
   * editor's `syncJsonToProgram` did on a tab switch.
   *
   * Only a document the validator accepts is applied, and what is applied is
   * the validator's output — what the device would store — so a clamp or a
   * dropped field shows up in the form rather than surviving in the text until
   * the save. Returns false when the text cannot be applied.
   */
  function applyJson(): boolean {
    if (json === null) return true;
    const result = parseProgramDocument(json);
    if (!result.ok) {
      setNotice({
        kind: 'error',
        message: t.editor.jsonRejected,
        details: issueLines(result.errors),
      });
      return false;
    }
    dispatch({ type: 'replaceDocument', program: result.program });
    setJson(null);
    setNotice(
      result.warnings.length > 0
        ? {
            kind: 'warning',
            message: t.editor.jsonApplied,
            details: issueLines(result.warnings),
          }
        : null,
    );
    return true;
  }

  function selectTab(next: Tab): void {
    if (next === tab) return;
    if (next === 'editor' && !applyJson()) return;
    if (next === 'json') setNotice(null);
    setTab(next);
  }

  function send(program: Program): void {
    if (target.kind === 'standalone') {
      // There is no device to assign an id or set `readonly` — both are
      // decided by the author instead, the same way a hand-written file
      // under `resources/programs/files/` already is (see the shipped
      // fixtures: `id` matches the filename, `readonly` is `true`).
      setExportProgram({ ...program, id: target.id, readonly: true });
      return;
    }
    if (target.kind === 'edit' && !sourceGone) {
      updateMutation.mutate({ id: target.id, program });
    } else {
      createMutation.mutate(program);
    }
  }

  /**
   * Save: the draft goes out through the same validator a picked file does, so
   * the clamps and drops the device would apply are seen here rather than
   * discovered on the next boot.
   */
  function handleSave(): void {
    // Unapplied JSON is what the user is looking at, so it is what gets saved —
    // the legacy editor's `syncJsonToProgram` on the way out of the tab.
    const pendingJson = json;
    const result = parseProgramDocument(pendingJson ?? toJson(state.draft));

    if (!result.ok) {
      setNotice({
        kind: 'error',
        message: t.editor.cannotSaveYet,
        details: issueLines(result.errors),
      });
      return;
    }

    // The form and the text now agree, on the document the device would store.
    if (pendingJson !== null) {
      dispatch({ type: 'replaceDocument', program: result.program });
      setJson(null);
    }

    // Only what this session introduced is refused; what the stored document
    // already had is shown in the dialog and left to the author. See
    // `authoringRegressions`.
    const stored = parseProgramDocument(state.baseline);
    const authoring = authoringIssues(result.program);
    const introduced = authoringRegressions(stored.ok ? authoringIssues(stored.program) : [], authoring);

    if (introduced.length > 0) {
      setNotice({ kind: 'error', message: t.editor.cannotSaveYet, details: issueLines(introduced) });
      return;
    }

    if (result.warnings.length > 0 || authoring.length > 0) {
      setPendingSave({ program: result.program, warnings: result.warnings, carried: authoring });
      return;
    }

    setNotice(null);
    send(result.program);
  }

  function handleClose(): void {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  const heading =
    target.kind === 'edit'
      ? t.editor.heading.edit(target.id)
      : target.kind === 'copy'
        ? t.editor.heading.copy(target.sourceTitle)
        : target.kind === 'standalone'
          ? t.editor.heading.standalone(target.id, target.originLabel)
          : t.editor.heading.new;

  const eventCount = state.draft.series.reduce((count, series) => count + series.events.length, 0);

  return (
    <section className={styles.editor} data-testid='program-editor'>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title} data-testid='editor-heading'>
            {heading}
          </h2>
          <p className={styles.meta} data-testid='editor-meta'>
            {t.editor.meta(state.draft.series.length, eventCount)}
            {dirty && (
              <>
                {' · '}
                <span className={styles.dirty} data-testid='editor-dirty'>
                  {t.editor.unsavedChanges}
                </span>
              </>
            )}
          </p>
        </div>
        <BankCountStepper count={state.bankCount} dispatch={dispatch} />
        <div className={styles.headerActions}>
          <div className={styles.tabs} role='tablist'>
            <button
              role='tab'
              id='editor-tab-editor'
              aria-selected={tab === 'editor'}
              aria-controls={TAB_PANEL_ID}
              className={clsx(styles.tab, tab === 'editor' && styles.tabActive)}
              data-testid='editor-tab-editor'
              onClick={() => selectTab('editor')}
            >
              {t.editor.tabs.editor}
            </button>
            <button
              role='tab'
              id='editor-tab-json'
              aria-selected={tab === 'json'}
              aria-controls={TAB_PANEL_ID}
              className={clsx(styles.tab, tab === 'json' && styles.tabActive)}
              data-testid='editor-tab-json'
              onClick={() => selectTab('json')}
            >
              {t.editor.tabs.json}
            </button>
          </div>
          <button className={styles.button} data-testid='editor-cancel' onClick={handleClose} disabled={busy}>
            {t.editor.close}
          </button>
          <button
            className={clsx(styles.button, styles.buttonPrimary)}
            data-testid='editor-save'
            onClick={handleSave}
            disabled={busy}
          >
            {deviceless ? t.editor.continue : target.kind === 'edit' && !sourceGone ? t.editor.save : t.editor.create}
          </button>
        </div>
      </header>

      {/* No Dismiss: it is the state of the world, not the result of a write,
          and it is the only thing explaining why Save says Create. */}
      {staleSource && <NoticeBanner notice={staleSource} testId='editor-source-notice' />}

      {notice && <NoticeBanner notice={notice} testId='editor-notice' onDismiss={() => setNotice(null)} />}

      <div
        id={TAB_PANEL_ID}
        role='tabpanel'
        aria-labelledby={tab === 'editor' ? 'editor-tab-editor' : 'editor-tab-json'}
      >
        {tab === 'editor' ? (
          <StructuredEditor state={state} dispatch={dispatch} audios={audios ?? []} />
        ) : (
          <JsonEditor
            text={jsonText}
            result={jsonResult}
            onChange={setJson}
            onFormat={() => {
              try {
                setJson(JSON.stringify(JSON.parse(jsonText), null, 2));
              } catch {
                // Not JSON yet; the errors under the textarea already say so.
              }
            }}
            filename={
              target.kind === 'edit' || target.kind === 'standalone' ? programFilename(target.id) : 'program.json'
            }
          />
        )}
      </div>

      <div className={styles.preview}>
        <h3 className={styles.sectionTitle}>{t.editor.preview}</h3>
        <Timeline
          program={toPreviewProgram(state.draft)}
          currentSeriesIndex={null}
          currentEventIndex={null}
          tickerMs={null}
        />
      </div>

      {pendingSave && (
        <ConfirmDialog
          title={
            pendingSave.warnings.length > 0 ? t.editor.pendingSave.titleWarnings : t.editor.pendingSave.titleCarried
          }
          body={
            <>
              {pendingSave.warnings.length > 0 && (
                <>
                  <p>{t.editor.pendingSave.storedAs}</p>
                  <ul data-testid='editor-warnings'>
                    {pendingSave.warnings.map((warning) => (
                      <li key={`${warning.path}:${warning.message}`}>
                        <code>{warning.path || '/'}</code> — {warning.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {pendingSave.carried.length > 0 && (
                <>
                  <p>{t.editor.pendingSave.carried}</p>
                  <ul data-testid='editor-carried'>
                    {pendingSave.carried.map((issue) => (
                      <li key={`${issue.path}:${issue.message}`}>
                        <code>{issue.path || '/'}</code> — {issue.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          }
          confirmLabel={
            target.kind === 'edit'
              ? t.editor.pendingSave.saveAnyway
              : deviceless
                ? t.editor.pendingSave.continueAnyway
                : t.editor.pendingSave.createAnyway
          }
          destructive={target.kind === 'edit'}
          onConfirm={() => {
            const pending = pendingSave;
            setPendingSave(null);
            setNotice(null);
            send(pending.program);
          }}
          onCancel={() => setPendingSave(null)}
        />
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title={t.editor.discard.title}
          body={t.editor.discard.body}
          confirmLabel={t.editor.discard.confirm}
          destructive
          onConfirm={() => {
            setConfirmDiscard(false);
            onClose();
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}

      {blocker.status === 'blocked' && (
        <ConfirmDialog
          title={t.editor.leave.title}
          body={t.editor.leave.body}
          confirmLabel={t.editor.leave.confirm}
          destructive
          onConfirm={blocker.proceed}
          onCancel={blocker.reset}
        />
      )}

      {exportProgram &&
        target.kind === 'standalone' &&
        renderExport?.({ program: exportProgram, origin: target.origin, onClose: () => setExportProgram(null) })}
    </section>
  );
}

// --- The structured editor ---

interface StructuredEditorProps {
  state: ReturnType<typeof createEditorState>;
  dispatch: React.Dispatch<EditorAction>;
  audios: AudioFile[];
}

function StructuredEditor({ state, dispatch, audios }: StructuredEditorProps): React.ReactNode {
  const t = useT();
  const { draft, collapsed, selection, bankCount } = state;

  return (
    <div className={styles.form}>
      <div className={styles.programFields}>
        <label className={styles.field}>
          <span className={styles.label}>{t.editor.fields.title}</span>
          <input
            className={styles.input}
            data-testid='editor-title'
            value={draft.title}
            onChange={(event) => dispatch({ type: 'setTitle', value: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t.editor.fields.description}</span>
          <input
            className={styles.input}
            data-testid='editor-description'
            value={draft.description}
            onChange={(event) => dispatch({ type: 'setDescription', value: event.target.value })}
          />
        </label>
      </div>

      <div className={styles.toolbar}>
        <button
          className={styles.button}
          data-testid='editor-add-series'
          onClick={() => dispatch({ type: 'addSeries' })}
        >
          {t.editor.toolbar.addSeries}
        </button>
        <button className={styles.button} onClick={() => dispatch({ type: 'setAllCollapsed', collapsed: true })}>
          {t.editor.toolbar.collapseAll}
        </button>
        <button className={styles.button} onClick={() => dispatch({ type: 'setAllCollapsed', collapsed: false })}>
          {t.editor.toolbar.expandAll}
        </button>
        <span className={styles.spacer} />
        <button
          className={styles.button}
          data-testid='editor-select-all'
          onClick={() => dispatch({ type: 'selectAllEvents' })}
        >
          {t.editor.toolbar.selectAllEvents}
        </button>
        {selection.length > 0 && (
          <>
            <span className={styles.selectionCount} data-testid='editor-selection-count'>
              {t.editor.toolbar.selected(selection.length)}
            </span>
            <button
              className={clsx(styles.button, styles.buttonDestructive)}
              data-testid='editor-delete-selected'
              onClick={() => dispatch({ type: 'removeSelected' })}
            >
              {t.editor.toolbar.deleteSelected}
            </button>
            <button className={styles.button} onClick={() => dispatch({ type: 'clearSelection' })}>
              {t.editor.toolbar.clearSelection}
            </button>
          </>
        )}
      </div>

      {draft.series.map((series, seriesIndex) => (
        <SeriesCard
          key={series.key}
          series={series}
          seriesIndex={seriesIndex}
          seriesCount={draft.series.length}
          collapsed={collapsed.includes(series.key)}
          selection={selection}
          audios={audios}
          bankCount={bankCount}
          dispatch={dispatch}
        />
      ))}
    </div>
  );
}

interface SeriesCardProps {
  series: DraftSeries;
  seriesIndex: number;
  seriesCount: number;
  collapsed: boolean;
  selection: string[];
  audios: AudioFile[];
  bankCount: number;
  dispatch: React.Dispatch<EditorAction>;
}

function SeriesCard({
  series,
  seriesIndex,
  seriesCount,
  collapsed,
  selection,
  audios,
  bankCount,
  dispatch,
}: SeriesCardProps): React.ReactNode {
  const t = useT();
  const seconds = Math.round(seriesMs(series) / 100) / 10;

  return (
    <div className={styles.series} data-testid={`editor-series-${seriesIndex}`}>
      <div className={styles.seriesHeader}>
        <button
          className={styles.collapseButton}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t.editor.series.expand(seriesIndex + 1) : t.editor.series.collapse(seriesIndex + 1)}
          data-testid={`editor-series-${seriesIndex}-collapse`}
          onClick={() => dispatch({ type: 'toggleCollapsed', key: series.key })}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className={styles.seriesNumber}>{seriesIndex + 1}</span>
        <input
          className={clsx(styles.input, styles.seriesName)}
          placeholder={t.editor.series.namePlaceholder}
          aria-label={t.editor.series.nameLabel(seriesIndex + 1)}
          data-testid={`editor-series-${seriesIndex}-name`}
          value={series.name}
          onChange={(event) => dispatch({ type: 'setSeriesName', series: seriesIndex, value: event.target.value })}
        />
        <label className={styles.checkbox}>
          <input
            type='checkbox'
            data-testid={`editor-series-${seriesIndex}-optional`}
            checked={series.optional}
            onChange={(event) =>
              dispatch({ type: 'setSeriesOptional', series: seriesIndex, value: event.target.checked })
            }
          />
          {t.editor.series.optional}
        </label>
        <span className={styles.seriesMeta} data-testid={`editor-series-${seriesIndex}-meta`}>
          {t.editor.series.meta(series.events.length, seconds)}
        </span>
        <RowActions
          prefix={`editor-series-${seriesIndex}`}
          what={t.editor.series.what(seriesIndex + 1)}
          canMoveUp={seriesIndex > 0}
          canMoveDown={seriesIndex < seriesCount - 1}
          canDelete={seriesCount > 1}
          onUp={() => dispatch({ type: 'moveSeries', from: seriesIndex, to: seriesIndex - 1 })}
          onDown={() => dispatch({ type: 'moveSeries', from: seriesIndex, to: seriesIndex + 1 })}
          onDuplicate={() =>
            dispatch({ type: 'duplicateSeries', series: seriesIndex, copySuffix: t.editor.copySuffix })
          }
          onDelete={() => dispatch({ type: 'removeSeries', series: seriesIndex })}
        />
      </div>

      {!collapsed && (
        <>
          {series.events.map((event, eventIndex) => (
            <EventRow
              key={event.key}
              event={event}
              seriesIndex={seriesIndex}
              eventIndex={eventIndex}
              eventCount={series.events.length}
              selected={selection.includes(event.key)}
              timerStart={series.timerStartKey === event.key}
              audios={audios}
              bankCount={bankCount}
              dispatch={dispatch}
            />
          ))}
          <button
            className={styles.button}
            data-testid={`editor-series-${seriesIndex}-add-event`}
            onClick={() => dispatch({ type: 'addEvent', series: seriesIndex })}
          >
            {t.editor.series.addEvent}
          </button>
        </>
      )}
    </div>
  );
}

const COMMANDS: DraftCommand[] = ['show', 'hide', 'none'];

interface EventRowProps {
  event: DraftEvent;
  seriesIndex: number;
  eventIndex: number;
  eventCount: number;
  selected: boolean;
  /** Whether the run clock starts on this event (#126). */
  timerStart: boolean;
  audios: AudioFile[];
  /** How many banks the editor offers. 1 is exactly the row this always was. */
  bankCount: number;
  dispatch: React.Dispatch<EditorAction>;
}

function EventRow({
  event,
  seriesIndex,
  eventIndex,
  eventCount,
  selected,
  timerStart,
  audios,
  bankCount,
  dispatch,
}: EventRowProps): React.ReactNode {
  const t = useT();
  const testId = `editor-event-${seriesIndex}-${eventIndex}`;
  const ms = durationMs(event);
  // An override on bank A alone leaves `banksRequired` - and so the stepper -
  // at 1. The controls still have to show it, or the editor would hide an
  // instruction the file carries and the device obeys.
  const named = BANK_LETTERS.filter((letter) => event.banks[letter] !== undefined);
  const letterCount = Math.max(bankCount, named.length === 0 ? 0 : BANK_LETTERS.indexOf(named[named.length - 1]) + 1);
  const showBanks = letterCount > 1 || named.length > 0;

  return (
    <div className={styles.event} data-testid={testId}>
      <input
        type='checkbox'
        aria-label={t.editor.event.select(eventIndex + 1, seriesIndex + 1)}
        data-testid={`${testId}-select`}
        checked={selected}
        onChange={() => dispatch({ type: 'toggleSelected', key: event.key })}
      />
      <span className={styles.eventNumber}>{eventIndex + 1}</span>

      <label className={styles.field}>
        <span className={styles.label}>{t.editor.event.durationLabel}</span>
        <span className={styles.durationRow}>
          {/* Text, not `type='number'`: a number input blanks its own value the
              moment the content stops parsing, so "12x" reached the reducer as
              "" and the field went on showing text the model no longer held.
              The point of keeping the duration as typed (see program-editor.ts)
              is that a half-written value survives to the validator, which is
              what explains it. `inputMode` still brings up the numeric keypad
              on the tablet this is used from. */}
          <input
            className={clsx(styles.input, styles.duration)}
            type='text'
            inputMode='numeric'
            aria-label={t.editor.event.durationAria(eventIndex + 1, seriesIndex + 1)}
            data-testid={`${testId}-duration`}
            value={event.duration}
            onChange={(change) =>
              dispatch({
                type: 'setEventDuration',
                series: seriesIndex,
                event: eventIndex,
                value: change.target.value,
              })
            }
          />
          {/* Milliseconds is what the device stores and what the field holds;
              the seconds are the number the shooter on the line hears. */}
          <span className={styles.hint} data-testid={`${testId}-seconds`}>
            {ms === null ? '—' : t.editor.event.seconds(Math.round(ms / 100) / 10)}
          </span>
        </span>
      </label>

      <fieldset className={styles.commands}>
        {/* The radio is the baseline the Except row overrides, so it stops being the whole answer. */}
        <legend className={styles.label}>{showBanks ? t.editor.event.allBanks : t.editor.event.targets}</legend>
        {COMMANDS.map((command) => (
          <label key={command} className={styles.checkbox}>
            <input
              type='radio'
              name={`${testId}-command`}
              data-testid={`${testId}-command-${command}`}
              checked={event.command === command}
              onChange={() =>
                dispatch({ type: 'setEventCommand', series: seriesIndex, event: eventIndex, value: command })
              }
            />
            {t.editor.event.commands[command]}
          </label>
        ))}
      </fieldset>

      {showBanks && (
        <fieldset className={styles.banks}>
          <legend className={styles.label}>{t.editor.event.except}</legend>
          {BANK_LETTERS.slice(0, letterCount).map((letter) => (
            <BankOverrideButton
              key={letter}
              testId={testId}
              letter={letter}
              value={event.banks[letter]}
              onCycle={(value) =>
                dispatch({ type: 'setEventBankOverride', series: seriesIndex, event: eventIndex, letter, value })
              }
            />
          ))}
        </fieldset>
      )}

      {/* A per-event control even though the field lives on the series: an
          author picks the moment the clock starts, and "which event" is how
          they think about it. Clicking the one already set clears it, so the
          series can go back to starting its clock at the top without a
          separate control for "none". */}
      <label className={styles.checkbox}>
        <input
          type='checkbox'
          data-testid={`${testId}-timer-start`}
          checked={timerStart}
          onChange={() =>
            dispatch({
              type: 'setSeriesTimerStart',
              series: seriesIndex,
              eventKey: timerStart ? null : event.key,
            })
          }
        />
        {t.editor.event.timerStartsHere}
      </label>

      <AudioPicker
        testId={testId}
        audioIds={event.audioIds}
        audios={audios}
        onAdd={(audioId) => dispatch({ type: 'addAudio', series: seriesIndex, event: eventIndex, audioId })}
        onRemove={(index) => dispatch({ type: 'removeAudio', series: seriesIndex, event: eventIndex, index })}
        onMove={(from, to) => dispatch({ type: 'moveAudio', series: seriesIndex, event: eventIndex, from, to })}
      />

      <RowActions
        prefix={testId}
        what={t.editor.event.what(eventIndex + 1, seriesIndex + 1)}
        canMoveUp={eventIndex > 0}
        canMoveDown={eventIndex < eventCount - 1}
        canDelete
        onUp={() => dispatch({ type: 'moveEvent', series: seriesIndex, from: eventIndex, to: eventIndex - 1 })}
        onDown={() => dispatch({ type: 'moveEvent', series: seriesIndex, from: eventIndex, to: eventIndex + 1 })}
        onDuplicate={() => dispatch({ type: 'duplicateEvent', series: seriesIndex, event: eventIndex })}
        onDelete={() => dispatch({ type: 'removeEvent', series: seriesIndex, event: eventIndex })}
      />

      {/* The three controls above say it in pieces; this says it as one thing,
          which is what catches "hide everything except B" written the other
          way round. Only where there is something to get wrong. */}
      {showBanks && (
        <p className={styles.eventSummary} aria-live='polite' data-testid={`${testId}-summary`}>
          {describeEvent(t.editor, event, letterCount)}
        </p>
      )}
    </div>
  );
}

/**
 * One letter, cycling – → show → hide → –.
 *
 * A button rather than a select: eight selects on a row is a wall, and the
 * three states are a cycle an author works through by tapping. The label
 * carries the current value in words, because the fill is a colour and the
 * dash is a glyph, and neither survives being read out.
 */
function BankOverrideButton({
  testId,
  letter,
  value,
  onCycle,
}: {
  testId: string;
  letter: BankLetter;
  value?: 'show' | 'hide';
  onCycle: (value: 'show' | 'hide' | null) => void;
}): React.ReactNode {
  const t = useT();
  const next = value === undefined ? 'show' : value === 'show' ? 'hide' : null;
  const word = (state: 'show' | 'hide' | null | undefined): string =>
    state ? t.editor.bank[state] : t.editor.bank.followsAll;

  return (
    <button
      type='button'
      className={clsx(styles.bankButton, value === 'show' && styles.bankShow, value === 'hide' && styles.bankHide)}
      data-testid={`${testId}-bank-${letter}`}
      aria-label={t.editor.bank.aria(letter, word(value), word(next))}
      onClick={() => onCycle(next)}
    >
      <span className={styles.bankLetter}>{letter}</span>
      <span className={styles.bankValue}>{value ? t.editor.bank[value] : '–'}</span>
    </button>
  );
}

/**
 * How many banks this program uses, 1…8. Derived from the document on load and
 * never stored in one: it decides what the editor offers, not what the device
 * is asked to do.
 */
function BankCountStepper({
  count,
  dispatch,
}: {
  count: number;
  dispatch: React.Dispatch<EditorAction>;
}): React.ReactNode {
  const t = useT();
  return (
    <div className={styles.bankStepper} role='group' aria-labelledby='editor-banks-label'>
      <span className={styles.label} id='editor-banks-label'>
        {t.editor.bankCount.label}
      </span>
      <span className={styles.stepper}>
        <button
          type='button'
          className={styles.stepperButton}
          data-testid='editor-banks-fewer'
          aria-label={t.editor.bankCount.fewer}
          disabled={count <= 1}
          onClick={() => dispatch({ type: 'setBankCount', value: count - 1 })}
        >
          −
        </button>
        <span className={styles.stepperValue} aria-live='polite' data-testid='editor-banks-count'>
          {count === 1 ? t.editor.bankCount.one : t.editor.bankCount.range(BANK_LETTERS[count - 1])}
        </span>
        <button
          type='button'
          className={styles.stepperButton}
          data-testid='editor-banks-more'
          aria-label={t.editor.bankCount.more}
          disabled={count >= BANK_LETTERS.length}
          onClick={() => dispatch({ type: 'setBankCount', value: count + 1 })}
        >
          +
        </button>
      </span>
    </div>
  );
}

interface AudioPickerProps {
  testId: string;
  audioIds: number[];
  audios: AudioFile[];
  onAdd: (audioId: number) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
}

/**
 * The clips an event starts, in the order they are listed.
 *
 * The device's shipped titles are still bare numbers for most clips, so both
 * the id and the title are shown; matching on either is what makes the list
 * usable at all until the titles are filled in.
 */
function AudioPicker({ testId, audioIds, audios, onAdd, onRemove, onMove }: AudioPickerProps): React.ReactNode {
  const t = useT();
  const [search, setSearch] = useState('');

  const term = search.trim().toLowerCase();
  const available = audios.filter(
    (audio) =>
      !audioIds.includes(audio.id) &&
      (term === '' || String(audio.id).includes(term) || audio.title.toLowerCase().includes(term)),
  );

  // `1. "Provserie" (50)` — the position first, because the order is what an
  // author is reading the list for; the title in quotes, because clip titles
  // are things like "1" and "10 sekunder" and an unquoted one reads as part of
  // the numbering; the id last, in brackets, because it is the thing you only
  // need when something is wrong.
  function titleOf(id: number): string {
    const audio = audios.find((entry) => entry.id === id);
    return audio ? `"${audio.title}" (${String(audio.id)})` : t.editor.audio.notOnDevice(id);
  }

  return (
    <div className={styles.audio}>
      <span className={styles.label}>{t.editor.audio.label}</span>
      <ul className={styles.chips} data-testid={`${testId}-audio-ids`}>
        {audioIds.map((id, index) => (
          <li key={id} className={styles.chip}>
            <span className={styles.chipOrder}>{index + 1}.</span>
            <span className={styles.chipTitle}>{titleOf(id)}</span>
            {/* Up and down, not left and right: the list runs down the page,
                and events and series in this same editor already reorder with
                ↑ / ↓. The labels stay "earlier" and "later" - that is what
                moving a clip does to the order it plays in, and it is the
                thing a screen reader should say. */}
            <button
              className={styles.chipButton}
              aria-label={t.editor.audio.earlier(id)}
              data-testid={`${testId}-audio-${id}-earlier`}
              disabled={index === 0}
              onClick={() => onMove(index, index - 1)}
            >
              ↑
            </button>
            <button
              className={styles.chipButton}
              aria-label={t.editor.audio.later(id)}
              data-testid={`${testId}-audio-${id}-later`}
              disabled={index === audioIds.length - 1}
              onClick={() => onMove(index, index + 1)}
            >
              ↓
            </button>
            <button
              className={styles.chipButton}
              aria-label={t.editor.audio.remove(id)}
              data-testid={`${testId}-audio-${id}-remove`}
              onClick={() => onRemove(index)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <span className={styles.audioControls}>
        <input
          className={clsx(styles.input, styles.audioSearch)}
          placeholder={t.editor.audio.searchPlaceholder}
          aria-label={t.editor.audio.searchAria}
          data-testid={`${testId}-audio-search`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className={styles.input}
          aria-label={t.editor.audio.addAria}
          data-testid={`${testId}-audio-add`}
          value=''
          onChange={(event) => {
            if (event.target.value !== '') onAdd(Number(event.target.value));
          }}
        >
          <option value=''>{t.editor.audio.addOption}</option>
          {available.map((audio) => (
            <option key={audio.id} value={audio.id}>
              {audio.id} · {audio.title}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

interface RowActionsProps {
  prefix: string;
  what: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  onUp: () => void;
  onDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/**
 * Move, copy and delete for a series or an event.
 *
 * Buttons rather than the legacy `⋮` menu and drag handles: the same four
 * operations, reachable from the keyboard, without a menu to position or a
 * drag to lose. Move-to-top and move-to-bottom are gone with the menu — a
 * program has a handful of series, and repeating a step is not the cost the
 * menu was worth.
 */
function RowActions({
  prefix,
  what,
  canMoveUp,
  canMoveDown,
  canDelete,
  onUp,
  onDown,
  onDuplicate,
  onDelete,
}: RowActionsProps): React.ReactNode {
  const t = useT();
  return (
    <span className={styles.rowActions}>
      <button
        className={styles.iconButton}
        aria-label={t.editor.rowActions.up(what)}
        data-testid={`${prefix}-up`}
        disabled={!canMoveUp}
        onClick={onUp}
      >
        ↑
      </button>
      <button
        className={styles.iconButton}
        aria-label={t.editor.rowActions.down(what)}
        data-testid={`${prefix}-down`}
        disabled={!canMoveDown}
        onClick={onDown}
      >
        ↓
      </button>
      <button
        className={styles.iconButton}
        aria-label={t.editor.rowActions.duplicate(what)}
        data-testid={`${prefix}-duplicate`}
        onClick={onDuplicate}
      >
        ⧉
      </button>
      <button
        className={clsx(styles.iconButton, styles.buttonDestructive)}
        aria-label={t.editor.rowActions.delete(what)}
        data-testid={`${prefix}-delete`}
        disabled={!canDelete}
        onClick={onDelete}
      >
        ×
      </button>
    </span>
  );
}

// --- The JSON view ---

interface JsonEditorProps {
  text: string;
  result: ReturnType<typeof parseProgramDocument> | null;
  onChange: (text: string) => void;
  onFormat: () => void;
  /** What the saved file is called - see `programFilename`. */
  filename: string;
}

/**
 * The document as the device will receive it.
 *
 * The legacy JSON tab was a textarea with line numbers, Prism highlighting and
 * ajv validation. The highlighting and the line numbers went with the 45 KB gz
 * those two libraries cost (D-18); the validation is the same
 * `parseProgramDocument` the rest of the app uses, which reports what the
 * device will change as well as what it will refuse.
 */
function JsonEditor({ text, result, onChange, onFormat, filename }: JsonEditorProps): React.ReactNode {
  const t = useT();
  const [copied, setCopied] = useState(false);

  // `navigator.clipboard` needs a secure context, and the device serves plain
  // HTTP over the range's WiFi - so on the tablet this is used from, it is
  // simply absent. Selecting the textarea is what is left: it does not copy on
  // its own, but it turns "copy this" into one keystroke instead of a drag
  // through several hundred lines.
  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      const box = document.querySelector<HTMLTextAreaElement>('[data-testid="editor-json"]');
      box?.focus();
      box?.select();
    }
  }

  return (
    <div className={styles.json}>
      <div className={styles.toolbar}>
        <button className={styles.button} data-testid='editor-json-format' onClick={onFormat}>
          {t.editor.json.format}
        </button>
        {/* Copies exactly what is in the box, like Download - a hand-edit in
            the textarea is the document the author means. */}
        <button
          className={styles.button}
          data-testid='editor-json-copy'
          onClick={() => {
            void handleCopy();
          }}
        >
          {copied ? t.editor.json.copied : t.editor.json.copy}
        </button>
        {/* Downloads exactly what is in the box, not the parsed draft: if
            somebody has hand-edited the JSON, that is the document they mean
            to keep. */}
        <button
          className={styles.button}
          data-testid='editor-json-download'
          onClick={() => {
            downloadJson(filename, text);
          }}
        >
          {t.editor.json.download}
        </button>
        <span className={styles.hint}>{t.editor.json.hint}</span>
      </div>
      <textarea
        className={styles.textarea}
        spellCheck={false}
        aria-label={t.editor.json.aria}
        data-testid='editor-json'
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
      {result && !result.ok && (
        <ul className={clsx(styles.issues, styles.issuesError)} data-testid='editor-json-errors'>
          {issueLines(result.errors).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {result?.ok && result.warnings.length > 0 && (
        <ul className={clsx(styles.issues, styles.issuesWarning)} data-testid='editor-json-warnings'>
          {issueLines(result.warnings).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
