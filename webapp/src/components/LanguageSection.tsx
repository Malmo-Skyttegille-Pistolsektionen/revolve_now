import { useT } from '../i18n';
import { LanguagePicker } from './LanguagePicker';
import styles from './ThemeSection.module.css';

export function LanguageSection(): React.ReactNode {
  const t = useT();
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{t.language.title}</h2>
      <LanguagePicker />
      <p className={styles.hint}>{t.language.hint}</p>
    </section>
  );
}
