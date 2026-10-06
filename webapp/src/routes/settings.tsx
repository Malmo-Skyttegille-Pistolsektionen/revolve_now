import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '../i18n';
import { ServerUrlSection } from '../components/ServerUrlSection';
import { ThemeSection } from '../components/ThemeSection';
import { LanguageSection } from '../components/LanguageSection';
import { ControlLockSection } from '../components/ControlLockSection';
import { StartupIssuesSection } from '../components/StartupIssuesSection';
import { StorageSection } from '../components/StorageSection';
import { UpdateSection } from '../components/UpdateSection';
import { BackupSection } from '../components/BackupSection';
import { NetworkSection } from '../components/NetworkSection';
import { AboutSection } from '../components/AboutSection';
import { RestartPendingNotice } from '../components/RestartPendingNotice';
import { SettingsFold, SettingsGroup } from '../components/SettingsFold';
import { useSettingsOverview } from '../hooks/useSettingsOverview';
import styles from './settings.module.css';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

/** The row a link opened, e.g. /settings#update. */
function initialFold(): string | null {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  return hash === '' ? null : hash;
}

function SettingsPage(): React.ReactNode {
  const t = useT();
  const o = t.settings.overview;
  const lines = useSettingsOverview();
  const [open, setOpen] = useState<string | null>(initialFold);

  // One open at a time, so the page stays as short as the overview.
  const toggle = (id: string): void => {
    const next = open === id ? null : id;
    setOpen(next);
    window.history.replaceState(null, '', next === null ? window.location.pathname : `#${next}`);
  };
  const fold = (
    id: string,
    title: string,
    line: (typeof lines)[keyof typeof lines],
    body: React.ReactNode,
    keepHeadings = false,
  ) => (
    <SettingsFold id={id} title={title} line={line} open={open === id} onToggle={toggle} keepHeadings={keepHeadings}>
      {body}
    </SettingsFold>
  );

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>{t.settings.title}</h1>

      {/* Above everything: a device running configuration it was told to
          replace is the thing that explains the next surprise, and the person
          reading this page may not be the one who saved it. */}
      <RestartPendingNotice />

      <dl className={styles.overview} aria-label={o.statusLabel} data-testid='settings-overview'>
        <dt>{o.firmware}</dt>
        <dd>{[lines.update.summary, lines.update.status?.label].filter(Boolean).join(' · ')}</dd>
        <dt>{o.connection}</dt>
        <dd>{lines.network.summary}</dd>
        <dt>{o.startup}</dt>
        <dd>{lines.startup.status?.label ?? lines.startup.summary}</dd>
        <dt>{o.controlLock}</dt>
        <dd>{lines.lock.status?.label}</dd>
      </dl>

      <SettingsGroup title={o.groups.device}>
        {fold('update', t.settings.update.title, lines.update, <UpdateSection />)}
        {fold('backup', t.settings.backup.title, lines.backup, <BackupSection />)}
        {/* Read-only, and the change is in Expert mode: which network the
            device looks for is a once-per-site decision behind the button
            press, not something this page should be able to do. */}
        {fold('network', t.settings.network.title, lines.network, <NetworkSection />)}
        {fold('control-lock', t.settings.controlLock.title, lines.lock, <ControlLockSection />)}
        {fold('storage', t.settings.storage.title, lines.storage, <StorageSection />)}
        {fold('startup-issues', t.settings.startupIssues.title, lines.startup, <StartupIssuesSection />)}
      </SettingsGroup>

      <SettingsGroup title={o.groups.browser}>
        {fold(
          'appearance',
          o.appearance,
          lines.appearance,
          <>
            <ThemeSection />
            <LanguageSection />
          </>,
          true,
        )}
        {fold('server-url', t.settings.serverUrl.title, lines.address, <ServerUrlSection />)}
        {fold('about', t.settings.about.title, lines.about, <AboutSection />)}
      </SettingsGroup>
    </div>
  );
}
