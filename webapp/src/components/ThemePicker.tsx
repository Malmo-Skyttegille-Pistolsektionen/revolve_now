import { useSettings } from '../context/SettingsContext';
import { useT } from '../i18n';
import { THEME_PREFERENCES } from '../lib/theme';
import { SegmentedControl } from './SegmentedControl';

/** System / Light / Dark as one segmented control. */
export function ThemePicker(): React.ReactNode {
  const { settings, setTheme } = useSettings();
  const t = useT();

  return (
    <SegmentedControl
      label={t.settings.theme.title}
      options={THEME_PREFERENCES}
      value={settings.theme}
      labels={t.settings.theme.options}
      onChange={setTheme}
    />
  );
}
