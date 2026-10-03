import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import clsx from 'clsx';
import { fileRejectionReason, isAcceptedFilename, MAX_FILE_BYTES, useAudiosApi } from '../api/audios';
import type { AudioFile, BackendIssuePayload } from '../api/types';
import { BackendIssueBanner } from '../components/BackendIssueBanner';
import { useSettings } from '../context/SettingsContext';
import { useControlLockStatus } from '../hooks/useControlLockStatus';
import { convertToDeviceWav, maxConvertedSeconds } from '../lib/audio-convert';
import styles from './audios.module.css';

export const Route = createFileRoute('/audios')({
  component: AudiosView,
});

interface Feedback {
  kind: 'error' | 'info';
  text: string;
}

/** `program_invalid` is about the program library, not this page. */
const CODES_HANDLED_ELSEWHERE: string[] = ['program_invalid'];

function titleFromFilename(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(0, lastDot) : name;
}

function AudiosView(): React.ReactNode {
  const audiosApi = useAudiosApi();
  const queryClient = useQueryClient();
  const { controlLockEnabled } = useControlLockStatus();
  const { controlLockToken } = useSettings();

  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [converting, setConverting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Bumped on every selection, so a conversion that finishes after the user
  // picked another file is dropped rather than replacing the newer choice.
  const selectionRef = useRef(0);

  // Same rule as the run view: the lock on without a token means spectator.
  const canControl = !controlLockEnabled || controlLockToken !== null;

  const {
    data: audios,
    isLoading,
    error: listError,
  } = useQuery({
    queryKey: ['audios'],
    queryFn: audiosApi.list,
  });

  // `useSSE` parks the last `backend_issue` here; this view is its first
  // consumer. Read-only cache subscription, like the run view's `state`.
  const { data: backendIssue } = useQuery<BackendIssuePayload | null>({
    queryKey: ['backend-issue'],
    queryFn: async () => null,
    initialData: null,
    enabled: false,
  });

  // `code` is an open enum, and this view is the only consumer there is, so
  // the filter names what belongs to somebody else rather than what belongs
  // here - an unrecognised code is shown rather than lost.
  const audioIssue =
    backendIssue !== null && !CODES_HANDLED_ELSEWHERE.includes(backendIssue.code) ? backendIssue : null;

  function resetForm(): void {
    setTitle('');
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  const playMutation = useMutation({
    mutationFn: (clip: AudioFile) => audiosApi.play(clip.id),
    onSuccess: (_result, clip) => setFeedback({ kind: 'info', text: `Playing "${clip.title}" on the device.` }),
    onError: (mutationError: Error, clip) =>
      setFeedback({ kind: 'error', text: `Could not play "${clip.title}": ${mutationError.message}` }),
  });

  const deleteMutation = useMutation({
    mutationFn: (clip: AudioFile) => audiosApi.remove(clip.id),
    onSuccess: async (_result, clip) => {
      setPendingDeleteId(null);
      setFeedback({ kind: 'info', text: `Deleted "${clip.title}".` });
      await queryClient.invalidateQueries({ queryKey: ['audios'] });
    },
    onError: (mutationError: Error, clip) => {
      setPendingDeleteId(null);
      // Includes the 409 "Audio is currently playing" — the one refusal a user
      // can act on, by waiting for the clip to finish.
      setFeedback({ kind: 'error', text: `Could not delete "${clip.title}": ${mutationError.message}` });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: audiosApi.upload,
    onSuccess: async (created, request) => {
      resetForm();
      setFeedback({ kind: 'info', text: `Uploaded "${request.title}" as clip ${created.id}.` });
      await queryClient.invalidateQueries({ queryKey: ['audios'] });
    },
    onError: (mutationError: Error) => setFeedback({ kind: 'error', text: `Upload failed: ${mutationError.message}` }),
  });

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const selected = event.target.files?.[0] ?? null;
    const selection = ++selectionRef.current;
    setConverting(false);

    if (selected && !isAcceptedFilename(selected.name)) {
      // Anything but a WAV is converted here (#273): the device decodes WAV only.
      setFile(null);
      setTitle(titleFromFilename(selected.name));
      setConverting(true);
      setFeedback({ kind: 'info', text: `Converting "${selected.name}"…` });
      try {
        const converted = await convertToDeviceWav(selected, MAX_FILE_BYTES);
        if (selection !== selectionRef.current) return;
        setFile(converted.file);
        setFeedback({
          kind: 'info',
          text: `Converted "${selected.name}": ${converted.seconds.toFixed(1)} s, ${converted.file.size} bytes.`,
        });
      } catch (conversionError) {
        if (selection !== selectionRef.current) return;
        setFeedback({ kind: 'error', text: (conversionError as Error).message });
      } finally {
        if (selection === selectionRef.current) setConverting(false);
      }
      return;
    }

    // A WAV goes up as it is. Checked on selection so the answer is immediate
    // and names the file, rather than arriving as the device's `No file
    // uploaded` after a round trip.
    const rejection = selected ? fileRejectionReason(selected) : null;
    if (rejection !== null) {
      setFile(null);
      setFeedback({ kind: 'error', text: rejection });
      return;
    }

    setFeedback(null);
    setFile(selected);
    if (selected) {
      setTitle(titleFromFilename(selected.name));
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!file || title.trim().length === 0) {
      return;
    }
    setFeedback(null);
    uploadMutation.mutate({ file, title: title.trim() });
  }

  const sorted = audios ? [...audios].sort((a, b) => a.id - b.id) : [];

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Audios</h1>

      {audioIssue && (
        <BackendIssueBanner
          issue={audioIssue}
          // Cleared in the cache, not hidden locally: the event is
          // fire-and-forget, so a dismissal has to outlive this mount. A later
          // issue writes a fresh object and shows again.
          onDismiss={() => queryClient.setQueryData(['backend-issue'], null)}
        />
      )}

      {feedback && (
        <div
          className={clsx(styles.feedback, feedback.kind === 'error' ? styles.feedbackError : styles.feedbackInfo)}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          data-testid='audios-feedback'
        >
          <span>{feedback.text}</span>
          <button
            type='button'
            className={styles.feedbackDismiss}
            onClick={() => setFeedback(null)}
            aria-label='Dismiss'
          >
            ×
          </button>
        </div>
      )}

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Upload a clip</h2>
        {canControl ? (
          <form className={styles.uploadForm} onSubmit={handleSubmit} data-testid='audios-upload-form'>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Audio file</span>
              <input
                ref={fileInputRef}
                className={styles.input}
                type='file'
                accept='.wav,.m4a,.mp3,.aac,audio/*'
                onChange={(event) => void handleFileChange(event)}
                data-testid='audios-upload-file'
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Title</span>
              <input
                className={styles.input}
                type='text'
                value={title}
                placeholder='Title'
                onChange={(event) => setTitle(event.target.value)}
                data-testid='audios-upload-title'
              />
            </label>
            <button
              className={clsx(styles.button, styles.buttonPrimary)}
              type='submit'
              disabled={!file || converting || title.trim().length === 0 || uploadMutation.isPending}
              data-testid='audios-upload-submit'
            >
              {converting ? 'Converting…' : uploadMutation.isPending ? 'Uploading…' : 'Upload'}
            </button>
            <p className={styles.hint}>
              A 16-bit PCM WAV, mono or stereo, is uploaded as it is, up to {MAX_FILE_BYTES} bytes. M4A, MP3 and
              anything else this browser can play is converted here first, up to{' '}
              {Math.floor(maxConvertedSeconds(MAX_FILE_BYTES))} s.
            </p>
          </form>
        ) : (
          <div className={styles.viewOnlyBadge} data-testid='audios-view-only'>
            <span className={styles.viewOnlyIcon}>👁</span>
            <span>View only — log in to play, upload or delete</span>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Audio library</h2>

        {isLoading && <p className={styles.empty}>Loading clips…</p>}
        {listError && <p className={styles.empty}>Could not load clips: {(listError as Error).message}</p>}
        {!isLoading && !listError && sorted.length === 0 && <p className={styles.empty}>No clips on the device.</p>}

        {sorted.length > 0 && (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope='col'>ID</th>
                  <th scope='col'>Title</th>
                  <th scope='col'>Source</th>
                  <th scope='col'>File</th>
                  <th scope='col' className={styles.actionsHeader}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((clip) => (
                  <tr key={clip.id} data-testid={`audios-row-${clip.id}`}>
                    <td className={styles.idCell}>{clip.id}</td>
                    <td className={styles.titleCell}>{clip.title}</td>
                    <td className={styles.sourceCell}>
                      <span
                        className={clsx(styles.badge, clip.readonly ? styles.badgeShipped : styles.badgeUploaded)}
                        data-testid={`audios-source-${clip.id}`}
                      >
                        {clip.readonly ? 'Shipped' : 'Uploaded'}
                      </span>
                    </td>
                    <td className={styles.fileCell}>{clip.filename}</td>
                    <td className={styles.actionsCell}>
                      {canControl ? (
                        <>
                          <button
                            className={clsx(styles.button, styles.buttonSecondary)}
                            type='button'
                            onClick={() => playMutation.mutate(clip)}
                            data-testid={`audios-play-${clip.id}`}
                          >
                            Play
                          </button>
                          {/* Shipped clips are flashed with the firmware:
                            there is no file behind them to remove, so the
                            device refuses the delete with a 409 that never
                            lifts (D-23). No button rather than a button that
                            can only fail. */}
                          {!clip.readonly &&
                            (pendingDeleteId === clip.id ? (
                              // Cancel first, so the harmless control - not
                              // Confirm - lands where Delete just was. The row
                              // is left-aligned under 768px and right-aligned
                              // above it, and a second tap on a phone would
                              // otherwise delete the clip outright.
                              <>
                                <button
                                  className={clsx(styles.button, styles.buttonSecondary)}
                                  type='button'
                                  onClick={() => setPendingDeleteId(null)}
                                  data-testid={`audios-delete-cancel-${clip.id}`}
                                >
                                  Cancel
                                </button>
                                <button
                                  className={clsx(styles.button, styles.buttonDestructive)}
                                  type='button'
                                  onClick={() => deleteMutation.mutate(clip)}
                                  data-testid={`audios-delete-confirm-${clip.id}`}
                                >
                                  Confirm
                                </button>
                              </>
                            ) : (
                              <button
                                className={clsx(styles.button, styles.buttonDestructiveGhost)}
                                type='button'
                                onClick={() => setPendingDeleteId(clip.id)}
                                data-testid={`audios-delete-${clip.id}`}
                              >
                                Delete
                              </button>
                            ))}
                        </>
                      ) : (
                        <span className={styles.noActions}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
