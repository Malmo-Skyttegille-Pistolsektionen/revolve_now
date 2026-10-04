import { useState } from 'react';
import clsx from 'clsx';
import { useSettings } from '../context/SettingsContext';
import { useControlLockStatus } from '../hooks/useControlLockStatus';
import { useT } from '../i18n';
import styles from './ControlLockSection.module.css';

function getActionErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

export function ControlLockSection(): React.ReactNode {
  const { controlLockToken } = useSettings();
  const t = useT();
  const s = t.settings.controlLock;
  const {
    controlLockEnabled,
    isLoading,
    enable,
    login,
    disable,
    logout,
    isEnablePending,
    isLoginPending,
    isDisablePending,
  } = useControlLockStatus();
  const [password, setPassword] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const isPending = isEnablePending || isLoginPending || isDisablePending;
  const isAuthenticated = controlLockEnabled && controlLockToken !== null;

  const handleEnable = async (): Promise<void> => {
    if (!password.trim()) {
      return;
    }

    setActionError(null);
    try {
      await enable(password);
      setPassword('');
    } catch (error) {
      setActionError(getActionErrorMessage(error, s.enableFailed));
    }
  };

  const handleLogin = async (): Promise<void> => {
    if (!password.trim()) {
      return;
    }

    setActionError(null);
    try {
      await login(password);
      setPassword('');
    } catch (error) {
      setActionError(getActionErrorMessage(error, s.loginFailed));
    }
  };

  const handleDisable = async (): Promise<void> => {
    setActionError(null);

    try {
      await disable();
    } catch (error) {
      setActionError(getActionErrorMessage(error, s.disableFailed));
    }
  };

  const handleLogout = (): void => {
    setActionError(null);
    logout();
  };

  if (isLoading) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{s.title}</h2>
        <div className={styles.loadingText}>{t.common.askingDevice}</div>
      </section>
    );
  }

  // State A: the lock is off, and anybody may drive.
  if (!controlLockEnabled) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{s.title}</h2>
        <div className={styles.form}>
          <div className={styles.statusRow}>
            <span className={clsx(styles.statusBadge, styles.statusOff)} data-testid='control-lock-status'>
              {s.statusOff}
            </span>
            <span className={styles.statusDescription}>{s.offDescription}</span>
          </div>
          <div className={styles.inputRow}>
            <input
              type='password'
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={s.choosePassword}
              data-testid='control-lock-password'
            />
            <button
              className={clsx(styles.button, styles.buttonPrimary)}
              onClick={handleEnable}
              disabled={!password.trim() || isPending}
            >
              {isPending ? s.locking : s.turnOn}
            </button>
          </div>
          {actionError && <div className={styles.errorMessage}>{actionError}</div>}
        </div>
      </section>
    );
  }

  // State B: the lock is on and this browser is not holding it.
  if (!isAuthenticated) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{s.title}</h2>
        <div className={styles.form}>
          <div className={styles.statusRow}>
            <span className={clsx(styles.statusBadge, styles.statusLocked)} data-testid='control-lock-status'>
              {s.statusLocked}
            </span>
            <span className={styles.statusDescription}>{s.lockedDescription}</span>
          </div>
          <div className={styles.inputRow}>
            <input
              type='password'
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={s.password}
              data-testid='control-lock-password'
            />
            <button
              className={clsx(styles.button, styles.buttonPrimary)}
              onClick={handleLogin}
              disabled={!password.trim() || isPending}
            >
              {isLoginPending ? s.loggingIn : s.logIn}
            </button>
          </div>
          <div className={styles.infoText}>{s.lockedInfo}</div>
          {actionError && <div className={styles.errorMessage}>{actionError}</div>}
        </div>
      </section>
    );
  }

  // State C: the lock is on and this browser is holding it.
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{s.title}</h2>
      <div className={styles.form}>
        <div className={styles.statusRow}>
          <span className={clsx(styles.statusBadge, styles.statusActive)} data-testid='control-lock-status'>
            {s.statusHeld}
          </span>
          <span className={styles.statusDescription}>{s.heldDescription}</span>
        </div>
        <div className={styles.buttonRow}>
          <button className={clsx(styles.button, styles.buttonSecondary)} onClick={handleLogout} disabled={isPending}>
            {s.logOut}
          </button>
          <button
            className={clsx(styles.button, styles.buttonDestructive)}
            onClick={handleDisable}
            disabled={isPending}
          >
            {isPending ? s.unlocking : s.turnOff}
          </button>
        </div>
        {actionError && <div className={styles.errorMessage}>{actionError}</div>}
      </div>
    </section>
  );
}
