import { createFileRoute, Link } from '@tanstack/react-router';
import { HardwareSection } from '../components/HardwareSection';
import { WifiConfigSection } from '../components/WifiConfigSection';
import { TroubleshootingSection } from '../components/TroubleshootingSection';
import { RestartToApply } from '../components/RestartToApply';
import { useConfigWindow } from '../hooks/useConfigWindow';
import { useT } from '../i18n';
import styles from './settings.module.css';

/**
 * Expert mode: everything behind the three-press window (#144, #263).
 *
 * Its own page rather than a section on Settings, and reachable only while the
 * device's configuration window is open. Everything here changes what the
 * device *is* rather than how this browser talks to it, and the failure modes
 * are not recoverable from the page that caused them:
 *
 *  - A wrong pin drives nothing.
 *  - A wrong hostname changes mDNS, so the device stops answering to the name
 *    everybody uses to reach it. Worse than a wrong pin, which at least leaves
 *    the web app reachable to fix it from.
 *  - A wrong network takes the device off the one this page is served over,
 *    once the restart that applies it happens.
 *
 * The membership rule is the gesture, not the subject: **if the firmware gates
 * it on the configuration window, it belongs here.** The troubleshooting bundle
 * used to sit on Settings and disappear when the window shut, which put a
 * control that vanishes without explanation on the page whose whole promise is
 * that nothing on it can hurt you.
 */
export const Route = createFileRoute('/hardware')({
  component: HardwarePage,
});

export function HardwarePage(): React.ReactNode {
  const { open, remainingSeconds } = useConfigWindow();
  const t = useT().hardware.page;

  return (
    <div className={styles.container}>
      <Link to='/settings' className={styles.backLink} data-testid='hardware-back'>
        {t.back}
      </Link>
      {/* Outside the window gate below, deliberately - D-42. */}
      <div className={styles.titleRow}>
        <h1 className={styles.title}>{t.title}</h1>
        <RestartToApply />
      </div>

      {/* The countdown lives here rather than in the tab: it answers "how long
          have I got", which is a question asked while typing a pin number, not
          while looking at the navigation. */}
      {open ? (
        <p className={styles.window} data-testid='config-window'>
          {t.unlockedBefore}
          <strong>{formatRemaining(remainingSeconds)}</strong>
          {t.unlockedPress}
          <strong>BOOT</strong>
          {t.unlockedAfter}
        </p>
      ) : (
        <p className={styles.windowShut} data-testid='config-window-shut'>
          {t.lockedBefore}
          <strong>{t.locked}</strong>
          {t.lockedPress}
          <strong>BOOT</strong>
          {t.lockedOnDevice}
          <strong>{t.lockedThreeTimes}</strong>
          {t.lockedWhere}
          <code>BOOT</code>
          {t.lockedOr}
          <code>FLASH</code>
          {t.lockedAfter}
        </p>
      )}

      {/* Not rendered while the window is shut. Both contracts say a client
          should decide whether to *offer* these settings rather than let
          somebody fill a form that cannot be submitted - and the window can
          lapse while the page is open, or the page be reached by a bookmark. */}
      {open && (
        <>
          {/* Before the pins: it is the one somebody arrives here for while
              the device is otherwise working, and the pins are a once-per-board
              job. */}
          <WifiConfigSection />

          <HardwareSection />

          {/* Last: it hands out a copy of the device's memory, so it is the
              heaviest thing on the page rather than the first thing offered. */}
          <TroubleshootingSection />
        </>
      )}
    </div>
  );
}

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes)}:${String(rest).padStart(2, '0')}`;
}
