import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useRef, useState } from 'react';
import { useDiagnosticsApi } from '../api/diagnostics';
import { useOtaApi } from '../api/ota';
import { useSettings } from '../context/SettingsContext';
import { useControlLockStatus } from '../hooks/useControlLockStatus';
import { useT } from '../i18n';
import { formatBytes } from '../lib/format-bytes';
import {
  FIRST_IN_APP_UPDATE,
  ReleaseCheckError,
  compareVersions,
  githubReleasesQuery,
  formatCheckedAt,
  sha256OfFile,
  type Release,
} from '../lib/release-check';
import { ConfirmDialog } from './ConfirmDialog';
import styles from './UpdateSection.module.css';

// Markdown rendering is most of this page's weight; the run screen never needs it.
const ReleaseNotes = lazy(() => import('./ReleaseNotes').then((module) => ({ default: module.ReleaseNotes })));

/**
 * Update the device without a cable (D-47): pick a GitHub release, or upload
 * an OTA file.
 *
 * The browser does all of the GitHub half and the device none of it. Opening
 * Settings checks the releases API; the chosen release's `-ota.bin` is an
 * ordinary download (its host sends no CORS header, so the page cannot fetch
 * the bytes itself), and the file the user then picks is held to the SHA-256
 * GitHub published for it before it is uploaded to `POST /ota`.
 *
 * Deliberately blunt about what is about to happen: either way the device
 * restarts, and on a range that means the targets stop answering for a few
 * seconds. The device does the refusing - a program running, an image for
 * another project - and its sentence is shown verbatim.
 */
export function UpdateSection(): React.ReactNode {
  const { controlLockToken } = useSettings();
  const { controlLockEnabled } = useControlLockStatus();
  const otaApi = useOtaApi();
  const diagnosticsApi = useDiagnosticsApi();
  const t = useT();
  const s = t.settings.update;
  // Same rule as the Programs page: the lock off means anyone may manage.
  const canManage = !controlLockEnabled || controlLockToken !== null;

  const githubFileRef = useRef<HTMLInputElement>(null);
  const plainFileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'verifying' | 'uploading' | 'restarting'>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [showPrereleases, setShowPrereleases] = useState(false);
  const [confirmingDowngrade, setConfirmingDowngrade] = useState(false);

  const { data: diagnostics } = useQuery({ queryKey: ['diagnostics'], queryFn: diagnosticsApi.info });
  const releasesQuery = useQuery(githubReleasesQuery);

  const running = diagnostics?.version;
  const runningLabel = running ?? t.common.unavailable;
  const all = releasesQuery.data ?? [];
  const listed = all.filter((release) => showPrereleases || !release.prerelease || release.version === running);
  const latest = all.find((release) => !release.prerelease);
  const newer = latest !== undefined && running !== undefined && compareVersions(latest.version, running) > 0;
  const selected: Release | undefined =
    listed.find((release) => release.version === chosen) ??
    listed.find((release) => release.version === latest?.version) ??
    listed[0];
  const direction = selected === undefined || running === undefined ? 1 : compareVersions(selected.version, running);
  const busy = state !== 'idle';

  const upload = async (file: File): Promise<void> => {
    setState('uploading');
    try {
      await otaApi.upload(file);
      setState('restarting');
      setNotice(s.accepted);
    } catch (error) {
      // RFC 9457 (D-19): the device's `detail` is the sentence written for this
      // situation, so it is shown as-is rather than second-guessed here.
      setNotice(error instanceof Error ? error.message : s.refused);
      setState('idle');
    }
  };

  const installVerified = async (file: File, release: Release): Promise<void> => {
    if (release.ota === null) return;
    setNotice(null);
    setState('verifying');
    if ((await sha256OfFile(file)) !== release.ota.sha256) {
      setNotice(s.mismatch(release.ota.name));
      setState('idle');
      return;
    }
    await upload(file);
  };

  const checkFailure =
    releasesQuery.error instanceof ReleaseCheckError
      ? releasesQuery.error.kind
      : releasesQuery.error !== null
        ? 'failed'
        : null;

  // A failed check is a check too: the time says when GitHub was last asked.
  const checkedAt = Math.max(releasesQuery.dataUpdatedAt, releasesQuery.errorUpdatedAt);

  const optionLabel = (release: Release): string => {
    const tags = [
      release.version === latest?.version ? s.latest : null,
      release.version === running ? s.installed : null,
      release.prerelease ? s.prerelease : null,
    ].filter((tag) => tag !== null);
    return [release.version, release.publishedAt.slice(0, 10), ...tags].filter(Boolean).join(' · ');
  };

  return (
    <section className={styles.section} data-testid='update-section'>
      <h2 className={styles.sectionTitle}>{s.title}</h2>

      <p className={styles.explain}>
        {s.explainBefore}
        <strong>{s.restartsDevice}</strong>
        {s.explainAfter}
      </p>

      <div className={styles.part} data-testid='update-github'>
        <h3 className={styles.partTitle}>{s.fromGithub}</h3>

        <p className={styles.explain} data-testid='update-check-status' role='status'>
          {releasesQuery.isFetching
            ? s.checking
            : checkFailure === 'unreachable'
              ? s.unreachable
              : checkFailure === 'rate-limited'
                ? s.rateLimited
                : checkFailure === 'failed'
                  ? s.failed
                  : latest === undefined
                    ? s.noReleases
                    : newer
                      ? s.available(latest.version, runningLabel)
                      : s.upToDate(runningLabel)}
        </p>

        <div className={styles.checkRow}>
          <button
            type='button'
            className={styles.buttonSecondary}
            data-testid='update-check'
            disabled={releasesQuery.isFetching}
            onClick={() => void releasesQuery.refetch()}
          >
            {s.checkAgain}
          </button>
          {checkedAt > 0 && (
            <span className={styles.muted} data-testid='update-last-checked'>
              {s.lastChecked(formatCheckedAt(checkedAt))}
            </span>
          )}
        </div>

        {selected !== undefined && (
          <>
            <div className={styles.pickerRow}>
              <label className={styles.pickerLabel}>
                {s.version}
                <select
                  className={styles.select}
                  data-testid='update-version'
                  value={selected.version}
                  disabled={busy}
                  onChange={(event) => setChosen(event.target.value)}
                >
                  {listed.map((release) => (
                    <option key={release.version} value={release.version}>
                      {optionLabel(release)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type='checkbox'
                  data-testid='update-prereleases'
                  checked={showPrereleases}
                  onChange={(event) => setShowPrereleases(event.target.checked)}
                />
                {s.showPrereleases}
              </label>
            </div>

            {selected.notes.trim() === '' ? (
              <p className={styles.muted}>{s.noNotes}</p>
            ) : (
              <details className={styles.notes} data-testid='update-notes'>
                <summary>{t.settings.overview.whatsNew(selected.version)}</summary>
                <Suspense fallback={null}>
                  <ReleaseNotes source={selected.notes} />
                </Suspense>
              </details>
            )}
            <a className={styles.link} href={selected.pageUrl} target='_blank' rel='noopener noreferrer'>
              {s.releasePage}
            </a>

            {selected.ota === null ? (
              <p className={styles.muted} data-testid='update-not-installable'>
                {s.notInstallable}
              </p>
            ) : (
              <>
                {direction < 0 && (
                  <p className={styles.warning} data-testid='update-downgrade-warning'>
                    {s.downgradeBody(selected.version, runningLabel)}
                  </p>
                )}
                <a
                  className={styles.buttonSecondary}
                  data-testid='update-download'
                  href={selected.ota.downloadUrl}
                  download={selected.ota.name}
                >
                  {s.stepDownload(selected.ota.name, formatBytes(selected.ota.size))}
                </a>
                <input
                  ref={githubFileRef}
                  type='file'
                  accept='.bin'
                  className={styles.fileInput}
                  data-testid='update-github-file'
                  disabled={!canManage || busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void installVerified(file, selected);
                  }}
                />
                <button
                  type='button'
                  className={styles.button}
                  data-testid='update-install'
                  disabled={!canManage || busy}
                  onClick={() => (direction < 0 ? setConfirmingDowngrade(true) : githubFileRef.current?.click())}
                >
                  {state === 'verifying' ? s.verifying : direction === 0 ? s.stepReinstall : s.stepInstall}
                </button>
                <p className={styles.muted}>{s.stepsHint}</p>
              </>
            )}
          </>
        )}
      </div>

      <div className={styles.part}>
        <h3 className={styles.partTitle}>{s.fromFile}</h3>
        <p className={styles.explain}>
          {s.fileHintBefore}
          <span className={styles.filename}>revolve_now-&lt;version&gt;-ota.bin</span>
          {s.fileHintAfter}
        </p>
        <input
          ref={plainFileRef}
          type='file'
          accept='.bin'
          className={styles.fileInput}
          data-testid='update-file-input'
          disabled={!canManage || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              setNotice(null);
              void upload(file);
            }
          }}
        />
        <button
          type='button'
          className={styles.button}
          data-testid='update-upload'
          disabled={!canManage || busy}
          onClick={() => plainFileRef.current?.click()}
        >
          {state === 'uploading' ? s.uploading : s.upload}
        </button>
      </div>

      {!canManage && <p className={styles.muted}>{s.logInToUpdate}</p>}
      {state === 'restarting' && <p className={styles.muted}>{t.common.restarting}</p>}
      {notice !== null && (
        <p className={styles.notice} data-testid='update-notice' role='status'>
          {notice}
        </p>
      )}

      {confirmingDowngrade && selected !== undefined && (
        <ConfirmDialog
          title={s.downgradeTitle(selected.version)}
          body={
            <>
              <p>{s.downgradeBody(selected.version, runningLabel)}</p>
              {compareVersions(selected.version, FIRST_IN_APP_UPDATE) < 0 && (
                <p>{s.downgradeNoUpdateCheck(selected.version)}</p>
              )}
            </>
          }
          confirmLabel={s.downgradeConfirm}
          destructive
          onConfirm={() => {
            setConfirmingDowngrade(false);
            githubFileRef.current?.click();
          }}
          onCancel={() => setConfirmingDowngrade(false)}
        />
      )}
    </section>
  );
}
