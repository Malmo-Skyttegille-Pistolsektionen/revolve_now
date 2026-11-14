import { useQuery } from '@tanstack/react-query';
import { useEthernetApi } from '../api/ethernet';
import { useT } from '../i18n';
import styles from './NetworkSection.module.css';

/**
 * The wired interface, read-only (#262) - the Ethernet half of Settings →
 * Network. Absent only on firmware that cannot have one (or predates the
 * endpoint); otherwise it says whether Ethernet is off, not found, unplugged or
 * serving, because "why is there no cable link" is the question asked here.
 */
export function EthernetPanel(): React.ReactNode {
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

  if (eth?.supported !== true) return null;

  return (
    <div className={styles.panel} data-testid='ethernet-section'>
      <h3 className={styles.panelTitle}>{s.title}</h3>

      {!eth.enabled ? (
        <p className={styles.muted} data-testid='ethernet-state'>
          {s.switchedOff}
        </p>
      ) : !eth.present ? (
        <p className={styles.muted} data-testid='ethernet-state'>
          {s.notFound}
        </p>
      ) : (
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
      )}
    </div>
  );
}
