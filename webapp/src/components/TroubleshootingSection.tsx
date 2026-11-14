import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useDiagnosticsApi } from '../api/diagnostics';
import { useConfigWindow } from '../hooks/useConfigWindow';
import { useT } from '../i18n';
import { datedFilename, downloadBlob } from '../lib/download';
import styles from './TroubleshootingSection.module.css';

/**
 * One file to send somebody when the device has misbehaved (#201): the
 * diagnostics response and, if the device panicked, the coredump that goes
 * with it. Getting a dump off a board used to mean a cable and a laptop with
 * ESP-IDF on it, and a dump on its own was a trap anyway — it decodes only
 * against the exact firmware that produced it, which stops being the running
 * one the moment the board is reflashed. The bundle carries that identity with
 * it.
 *
 * **On the Expert mode page**, because the firmware gates it on the
 * configuration window — three presses of BOOT — and that gesture is what
 * decides where a control lives (#263). It sat on Settings until then and
 * simply vanished when the window shut, which is a poor thing to do on the page
 * whose promise is that nothing on it can hurt you.
 *
 * A coredump is a raw RAM snapshot and can hold the WiFi password, so what has
 * to be established is that whoever collects it is standing at the board. The
 * firmware refuses on the same condition — this is not a hidden button in front
 * of an open door, and the check below stays for the case where the window
 * lapses while the page is open.
 *
 * The control lock is deliberately not consulted. It is write protection, for one
 * operator running a competition without others interfering, and this is a
 * read — gating it there would have blocked a club member from collecting a
 * fault report during exactly the event where a fault matters most.
 */
export function TroubleshootingSection(): React.ReactNode {
  const { open: windowOpen } = useConfigWindow();
  const diagnosticsApi = useDiagnosticsApi();
  const s = useT().settings.troubleshooting;
  const [state, setState] = useState<'idle' | 'downloading'>('idle');
  const [notice, setNotice] = useState<string | null>(null);

  const { data: diagnostics } = useQuery({
    queryKey: ['diagnostics'],
    queryFn: diagnosticsApi.info,
  });

  if (!windowOpen) return null;

  const download = async (): Promise<void> => {
    setNotice(null);
    setState('downloading');

    try {
      const file = await diagnosticsApi.bundle();
      // The device names it; this side adds the date, which is the one part of
      // the name a device with no clock cannot know.
      downloadBlob(datedFilename(file.filename ?? 'revolve-now-diagnostics.zip', new Date()), file.blob);
      setNotice(s.downloaded);
    } catch (error) {
      // RFC 9457 (D-19): the device's `detail` is the sentence written for
      // this situation — including the one that says how to open the window.
      const detail = error instanceof Error ? error.message : null;
      setNotice(detail ?? s.refused);
    } finally {
      setState('idle');
    }
  };

  return (
    <section className={styles.section} data-testid='troubleshooting-section'>
      <h2 className={styles.sectionTitle}>{s.title}</h2>

      <p className={styles.explain}>{s.explain}</p>

      <p className={styles.explain}>
        {s.sensitiveBefore}
        <strong>{s.wifiPassword}</strong>
        {s.sensitiveAfter}
      </p>

      <p className={styles.state} data-testid='troubleshooting-coredump'>
        {diagnostics?.coredumpPresent === true ? s.coredumpPresent : s.coredumpAbsent}
      </p>

      <button
        type='button'
        className={styles.button}
        data-testid='troubleshooting-download'
        disabled={state !== 'idle'}
        onClick={() => void download()}
      >
        {state === 'downloading' ? s.preparing : s.download}
      </button>

      {notice !== null && (
        <p className={styles.notice} data-testid='troubleshooting-notice' role='status'>
          {notice}
        </p>
      )}
    </section>
  );
}
