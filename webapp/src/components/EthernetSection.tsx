import { useQuery } from '@tanstack/react-query';
import { useEthernetApi } from '../api/ethernet';
import { useT } from '../i18n';
import styles from './WifiSection.module.css';

/**
 * The wired interface, read-only, beside WiFi (#262).
 *
 * Shown only when a controller answered at boot. A board without a W5500 is
 * the common case, and a section saying so on every one of them would be noise;
 * the pins live in Expert mode, and the serial console's `status` says whether
 * the probe found anything.
 */
export function EthernetSection(): React.ReactNode {
  const ethernetApi = useEthernetApi();
  const t = useT();
  const s = t.settings.ethernet;

  const { data: eth } = useQuery({
    queryKey: ['ethernet'],
    queryFn: ethernetApi.status,
    // Link state is what changes: somebody plugging the cable in and watching.
    refetchInterval: 15000,
    // A firmware older than the endpoint answers 404; that is "no Ethernet".
    retry: false,
  });

  if (eth?.present !== true) return null;

  return (
    <section className={styles.section} data-testid='ethernet-section'>
      <h2 className={styles.sectionTitle}>{s.title}</h2>

      <dl className={styles.rows}>
        <dt className={styles.label}>{s.link}</dt>
        <dd className={styles.value} data-testid='ethernet-link'>
          {eth.linkUp ? s.linkSpeed(eth.speedMbps, eth.fullDuplex) : <span className={styles.muted}>{s.noLink}</span>}
        </dd>

        <dt className={styles.label}>{s.address}</dt>
        <dd className={styles.value} data-testid='ethernet-ip'>
          {eth.ipAddress !== '' ? eth.ipAddress : <span className={styles.muted}>{s.noneYet}</span>}
        </dd>

        <dt className={styles.label}>{s.mac}</dt>
        <dd className={styles.value} data-testid='ethernet-mac'>
          {eth.macAddress}
        </dd>
      </dl>
    </section>
  );
}
