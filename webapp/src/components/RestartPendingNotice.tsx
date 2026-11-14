import { Link } from '@tanstack/react-router';
import { useRestartPending } from '../hooks/useRestartPending';
import { useT } from '../i18n';
import styles from './RestartPendingNotice.module.css';

/**
 * One line on Settings when the device holds configuration it is not running
 * (#341), so a saved-but-not-applied change is not invisible to whoever picks
 * the device up next.
 *
 * A statement, not a control: restarting is an Expert mode act, behind the
 * button press that authorised the save. This only says where to go.
 */
export function RestartPendingNotice(): React.ReactNode {
  const pending = useRestartPending();
  const s = useT().settings.restartPending;
  if (!pending) return null;

  return (
    <p className={styles.notice} data-testid='restart-pending-notice'>
      {s.before}
      <Link to='/hardware'>{s.expertMode}</Link>
      {s.after}
    </p>
  );
}
