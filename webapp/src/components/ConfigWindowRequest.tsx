import clsx from 'clsx';
import { ApiError } from '../api/client';
import { useConfigWindow } from '../hooks/useConfigWindow';
import { useT } from '../i18n';
import { formatRemaining } from '../lib/format-remaining';
import styles from './ConfigWindowRequest.module.css';

/**
 * Asking for the configuration window, and what to do next (D-52).
 *
 * The window opens for the browser that asked, when somebody presses BOOT
 * three times - so the request comes first and the presses last. Renders
 * `whenOpen` once this browser holds the window, and nothing if that is unset.
 */
export function ConfigWindowRequest({
  intro,
  whenOpen = null,
}: {
  /** What the window is for, here; the general explanation when absent. */
  intro?: string;
  whenOpen?: React.ReactNode;
}): React.ReactNode {
  const { state, remainingSeconds, request, requesting, requestError } = useConfigWindow();
  const s = useT().settings.configWindow;

  if (state === 'open') return whenOpen;

  if (state === 'pending') {
    return (
      <div className={clsx(styles.panel, styles.pending)} role='status' data-testid='config-window-pending'>
        <p className={styles.text}>
          <strong>{s.pending}</strong>
        </p>
        <p className={styles.text}>{s.waiting(formatRemaining(remainingSeconds))}</p>
      </div>
    );
  }

  const detail = requestError instanceof ApiError ? requestError.problem?.detail : undefined;
  const lead = state === 'conflict' ? s.conflict : state === 'elsewhere' ? s.elsewhere : (intro ?? s.explain);

  return (
    <div className={styles.panel} data-testid={`config-window-${state}`}>
      <p className={styles.text}>{lead}</p>
      <button
        type='button'
        className={styles.button}
        onClick={request}
        disabled={requesting}
        data-testid='config-window-request'
      >
        {requesting ? s.asking : s.ask}
      </button>
      {requestError !== null && (
        <p className={styles.error} role='alert'>
          {detail ? `${s.failed} ${detail}` : s.failed}
        </p>
      )}
    </div>
  );
}
