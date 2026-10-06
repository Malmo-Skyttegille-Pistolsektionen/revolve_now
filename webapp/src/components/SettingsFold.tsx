import clsx from 'clsx';
import type { Line } from '../hooks/useSettingsOverview';
import styles from './SettingsFold.module.css';

/**
 * A titled list of folds, e.g. "Device". `expert` gives it Expert mode's amber
 * frame: settings whose way back can be a USB cable.
 */
export function SettingsGroup({
  title,
  expert = false,
  note,
  children,
}: {
  title: string;
  expert?: boolean;
  /** A line under the heading that holds for every row in the group. */
  note?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className={styles.group}>
      <h2 className={styles.groupTitle}>{title}</h2>
      {note && <p className={styles.note}>{note}</p>}
      <div className={clsx(styles.list, expert && styles.expert)}>{children}</div>
    </div>
  );
}

interface FoldProps {
  /** Also the URL fragment that opens it: /settings#update. */
  id: string;
  title: string;
  line: Line;
  open: boolean;
  onToggle: (id: string) => void;
  /** For a row holding more than one section, whose headings tell them apart. */
  keepHeadings?: boolean;
  children: React.ReactNode;
}

/**
 * One Settings topic as a row that folds open in place (#525). The section
 * stays mounted while folded, so a half-typed field or an upload in progress
 * survives opening another row; its own card and heading are dropped by the
 * stylesheet, since the row already names it.
 */
export function SettingsFold({ id, title, line, open, onToggle, keepHeadings, children }: FoldProps): React.ReactNode {
  const bodyId = `settings-${id}`;
  return (
    <div className={clsx(styles.fold, open && styles.open)} data-testid={`settings-fold-${id}`}>
      <button
        type='button'
        className={styles.row}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle(id)}
      >
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
          <span className={styles.summary}>{line.summary}</span>
        </span>
        {line.status && (
          <span className={clsx(styles.pill, line.status.tone === 'attention' && styles.attention)}>
            {line.status.label}
          </span>
        )}
        <span className={styles.chevron} aria-hidden='true'>
          ›
        </span>
      </button>
      <div id={bodyId} className={clsx(styles.body, keepHeadings && styles.keepHeadings)} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
