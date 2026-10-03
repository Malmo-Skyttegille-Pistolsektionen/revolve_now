import { useId } from 'react';
import clsx from 'clsx';
import { useSettings } from '../context/SettingsContext';
import { THEME_PREFERENCES, type ThemePreference } from '../lib/theme';
import styles from './ThemePicker.module.css';

const LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** System / Light / Dark as one segmented control - the way a phone offers it. */
export function ThemePicker({ label = 'Theme' }: { label?: string }): React.ReactNode {
  const { settings, setTheme } = useSettings();
  const groupId = useId();

  return (
    <div className={styles.picker} role='radiogroup' aria-label={label}>
      {THEME_PREFERENCES.map((theme) => (
        <label key={theme} className={clsx(styles.option, settings.theme === theme && styles.optionActive)}>
          <input
            className={styles.radio}
            type='radio'
            name={groupId}
            value={theme}
            checked={settings.theme === theme}
            onChange={() => setTheme(theme)}
          />
          {LABELS[theme]}
        </label>
      ))}
    </div>
  );
}
