import styles from './Logo.module.css';

/** The Revolve Now logo, symbol and name. The name is real text for screen readers and tests. */
export function Logo(): React.ReactNode {
  return (
    <span className={styles.logo}>
      <span className={styles.name}>Revolve Now</span>
    </span>
  );
}
