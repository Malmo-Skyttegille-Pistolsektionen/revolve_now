import { useT } from '../i18n';
import { EthernetPanel } from './EthernetPanel';
import { WifiPanel } from './WifiPanel';
import styles from './NetworkSection.module.css';

/**
 * How the device is connected: WiFi and, on a board that can have one, the
 * wired interface (#262). Read-only, like the rest of Settings; switching
 * either off, and moving WiFi to another network, are in Expert mode.
 */
export function NetworkSection(): React.ReactNode {
  const t = useT();

  return (
    <section className={styles.section} data-testid='network-section'>
      <h2 className={styles.sectionTitle}>{t.settings.network.title}</h2>
      <WifiPanel />
      <EthernetPanel />
    </section>
  );
}
