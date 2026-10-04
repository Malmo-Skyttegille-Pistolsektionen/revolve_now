import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useT } from '../i18n';
import { initializeBaseUrl } from '../api/client';
import { ServerUrlSection } from '../components/ServerUrlSection';
import { ThemeSection } from '../components/ThemeSection';
import { LanguageSection } from '../components/LanguageSection';
import { ControlLockSection } from '../components/ControlLockSection';
import { StartupIssuesSection } from '../components/StartupIssuesSection';
import { StorageSection } from '../components/StorageSection';
import { FirmwareSection } from '../components/FirmwareSection';
import { WifiSection } from '../components/WifiSection';
import { AboutSection } from '../components/AboutSection';
import { RestartPendingNotice } from '../components/RestartPendingNotice';
import styles from './settings.module.css';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function SettingsPage(): React.ReactNode {
  const { settings } = useSettings();
  const t = useT();

  // Initialize base URL on mount - only run once on initial mount
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      initializeBaseUrl(settings.serverBaseUrl);
    }
  }, [settings.serverBaseUrl]);

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>{t.settings.title}</h1>

      {/* Above everything: a device running configuration it was told to
          replace is the thing that explains the next surprise, and the person
          reading this page may not be the one who saved it. */}
      <RestartPendingNotice />

      <ServerUrlSection />

      <ThemeSection />

      <LanguageSection />

      <ControlLockSection />

      <StartupIssuesSection />

      <StorageSection />

      {/* Read-only, and the change is in Expert mode: which network the device
          looks for is a once-per-site decision behind the button press, not
          something this page should be able to do. */}
      <WifiSection />

      <FirmwareSection />

      <AboutSection />
    </div>
  );
}
