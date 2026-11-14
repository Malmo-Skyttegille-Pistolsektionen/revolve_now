import { useT } from '../i18n';
import { ThemePicker } from './ThemePicker';
import styles from './ThemeSection.module.css';

export function ThemeSection(): React.ReactNode {
  const t = useT();
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{t.settings.theme.title}</h2>
      <ThemePicker />
      <p className={styles.hint}>{t.settings.theme.hint}</p>
    </section>
  );
}
