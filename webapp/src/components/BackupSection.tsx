import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useBackupApi } from '../api/backup';
import type { RestoreItem, RestoreReport } from '../api/types';
import { useSettings } from '../context/SettingsContext';
import { useConfigWindow } from '../hooks/useConfigWindow';
import { useControlLockStatus } from '../hooks/useControlLockStatus';
import { useT } from '../i18n';
import { datedFilename, downloadBlob } from '../lib/download';
import styles from './BackupSection.module.css';

/**
 * Save what a club has put on this board, and put it back (#520) — before a
 * firmware update, onto a replacement board, or onto a second one.
 *
 * The device builds and reads the file and decides every item on its own; this
 * section moves the file and reports what came back. On Settings rather than
 * in Expert mode because most of a restore — programs and clips — needs no
 * button press. The hardware part does, and the device skips it and says so
 * when the window is shut, so the checkbox stays offered with a hint rather
 * than hidden.
 */
export function BackupSection(): React.ReactNode {
  const { controlLockToken } = useSettings();
  const { controlLockEnabled } = useControlLockStatus();
  const { open: windowOpen } = useConfigWindow();
  const backupApi = useBackupApi();
  const queryClient = useQueryClient();
  const s = useT().settings.backup;
  // Same rule as the Programs page: the lock off means anyone may manage.
  const canManage = !controlLockEnabled || controlLockToken !== null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'downloading' | 'restoring'>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [hardware, setHardware] = useState(true);
  const [name, setName] = useState(false);

  const download = async (): Promise<void> => {
    setNotice(null);
    setReport(null);
    setState('downloading');
    try {
      const file = await backupApi.download();
      // The device has no clock, so the date is added here.
      downloadBlob(datedFilename(file.filename ?? 'revolve-now-backup.zip', new Date()), file.blob);
      setNotice(s.downloaded);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : s.downloadRefused);
    } finally {
      setState('idle');
    }
  };

  const restore = async (file: File): Promise<void> => {
    setNotice(null);
    setReport(null);
    setState('restoring');
    try {
      setReport(await backupApi.restore(file, { hardware, name: hardware && name }));
    } catch (error) {
      // RFC 9457 (D-19): the device's `detail` says what was wrong with the file.
      setNotice(error instanceof Error ? error.message : s.restoreRefused);
    } finally {
      setState('idle');
      // libraryChanged refreshes the lists; the saved hardware configuration
      // has no event, and the restart notice reads it from here.
      void queryClient.invalidateQueries({ queryKey: ['hardware-config'] });
    }
  };

  return (
    <section className={styles.section} data-testid='backup-section'>
      <h2 className={styles.sectionTitle}>{s.title}</h2>

      <p className={styles.explain}>{s.explain}</p>
      <p className={styles.explain}>
        {s.noWifiBefore}
        <strong>{s.wifiPassword}</strong>
        {s.noWifiAfter}
      </p>

      <button
        type='button'
        className={styles.button}
        data-testid='backup-download'
        disabled={state !== 'idle'}
        onClick={() => void download()}
      >
        {state === 'downloading' ? s.preparing : s.download}
      </button>

      <h3 className={styles.subTitle}>{s.restoreTitle}</h3>
      <p className={styles.explain}>{s.restoreExplain}</p>

      <label className={styles.option}>
        <input
          type='checkbox'
          checked={hardware}
          data-testid='backup-restore-hardware'
          disabled={state !== 'idle'}
          onChange={(event) => setHardware(event.target.checked)}
        />
        {s.restoreHardware}
      </label>
      {hardware && !windowOpen && (
        <p className={styles.hint} data-testid='backup-window-hint'>
          {s.hardwareNeedsWindow}
        </p>
      )}

      <label className={styles.option}>
        <input
          type='checkbox'
          checked={hardware && name}
          data-testid='backup-restore-name'
          disabled={state !== 'idle' || !hardware}
          onChange={(event) => setName(event.target.checked)}
        />
        {s.restoreName}
      </label>
      <p className={styles.hint}>{s.nameHint}</p>

      <input
        ref={fileInputRef}
        type='file'
        accept='.zip,application/zip'
        className={styles.fileInput}
        data-testid='backup-file-input'
        disabled={!canManage || state !== 'idle'}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void restore(file);
        }}
      />
      <button
        type='button'
        className={styles.button}
        data-testid='backup-restore'
        disabled={!canManage || state !== 'idle'}
        onClick={() => fileInputRef.current?.click()}
      >
        {state === 'restoring' ? s.restoring : s.restore}
      </button>
      {!canManage && <p className={styles.muted}>{s.logInToRestore}</p>}

      {notice !== null && (
        <p className={styles.notice} data-testid='backup-notice' role='status'>
          {notice}
        </p>
      )}

      {report !== null && <RestoreSummary report={report} />}
    </section>
  );
}

function RestoreSummary({ report }: { report: RestoreReport }): React.ReactNode {
  const s = useT().settings.backup;
  const { hardware } = report;
  const label = (item: RestoreItem): string => (item.title === '' ? s.untitled(item.sourceId) : item.title);
  const count = (items: RestoreItem[], result: RestoreItem['result']): number =>
    items.filter((item) => item.result === result).length;
  const refused = [...report.audios, ...report.programs].filter((item) => item.result === 'refused');
  const dropped = report.programs.filter((item) => (item.droppedAudioIds?.length ?? 0) > 0);

  return (
    <div className={styles.report} data-testid='backup-report' role='status'>
      <p>{s.from(report.source.hostname, report.source.firmwareVersion)}</p>
      <ul className={styles.counts}>
        <li data-testid='backup-report-programs'>
          {s.programs}:{' '}
          {s.counts(
            count(report.programs, 'added'),
            count(report.programs, 'skipped'),
            count(report.programs, 'refused'),
          )}
        </li>
        <li data-testid='backup-report-audios'>
          {s.audios}:{' '}
          {s.counts(count(report.audios, 'added'), count(report.audios, 'skipped'), count(report.audios, 'refused'))}
        </li>
      </ul>
      <p data-testid='backup-report-hardware'>
        {s.hardware[hardware.result]}
        {hardware.problem && <> {hardware.problem.detail}</>}
      </p>
      {refused.length > 0 && (
        <ul className={styles.problems} data-testid='backup-report-refused'>
          {refused.map((item) => (
            <li key={`${item.sourceId}-${label(item)}`}>
              {label(item)}: {item.problem?.detail}
            </li>
          ))}
        </ul>
      )}
      {dropped.map((item) => (
        <p key={item.sourceId} className={styles.warning}>
          {s.droppedAudio(label(item), item.droppedAudioIds?.length ?? 0)}
        </p>
      ))}
      {report.stoppedEarly && (
        <p className={styles.warning} data-testid='backup-report-stopped'>
          {s.stoppedEarly} {report.stoppedEarly.detail}
        </p>
      )}
    </div>
  );
}
