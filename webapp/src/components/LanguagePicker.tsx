import { useSettings } from '../context/SettingsContext';
import { useT } from '../i18n';
import { LANGUAGE_PREFERENCES } from '../i18n/language';
import { SegmentedControl } from './SegmentedControl';

/**
 * System / English / Svenska as one segmented control. A language is named
 * in itself, so the option is readable to the person who needs it most: the
 * one looking at a page in the wrong language.
 */
export function LanguagePicker({ label }: { label?: string }): React.ReactNode {
  const { settings, setLanguage } = useSettings();
  const t = useT();

  return (
    <SegmentedControl
      label={label ?? t.language.title}
      options={LANGUAGE_PREFERENCES}
      value={settings.language}
      labels={t.language.options}
      onChange={setLanguage}
    />
  );
}
