import { useRef, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import { useT } from '../i18n';
import styles from './CountdownModal.module.css';

interface CountdownModalProps {
  seconds: number;
  onCancel: () => void;
  onStartNow: () => void;
}

export function CountdownModal({ seconds, onCancel, onStartNow }: CountdownModalProps): React.ReactNode {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [onCancel],
  );

  const handleBackdropClick = useCallback((e: React.MouseEvent): void => {
    if (e.target === dialogRef.current) {
      e.preventDefault();
    }
  }, []);

  return (
    <dialog ref={dialogRef} className={styles.dialog} onKeyDown={handleKeyDown} onClick={handleBackdropClick}>
      <div className={styles.content}>
        <div className={styles.label}>{t.run.countdown.startingIn}</div>
        <div className={styles.countdown} data-testid='countdown-seconds' key={seconds}>
          {seconds}
        </div>
        <div className={styles.buttonRow}>
          <button className={clsx(styles.button, styles.buttonStartNow)} onClick={onStartNow}>
            {t.run.countdown.startNow}
          </button>
          <button className={clsx(styles.button, styles.buttonCancel)} onClick={onCancel} autoFocus>
            {t.run.countdown.cancel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
