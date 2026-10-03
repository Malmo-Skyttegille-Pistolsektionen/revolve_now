import { ThemePicker } from './ThemePicker';
import styles from './ThemeSection.module.css';

export function ThemeSection(): React.ReactNode {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Theme</h2>
      <ThemePicker />
      <p className={styles.hint}>
        System follows this phone or computer&apos;s own light or dark setting. Kept in this browser only, like the
        server URL.
      </p>
    </section>
  );
}
