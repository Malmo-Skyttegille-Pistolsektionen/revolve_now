import { useId } from 'react';
import clsx from 'clsx';
import styles from './SegmentedControl.module.css';

interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T;
  labels: Record<T, string>;
  onChange: (value: T) => void;
}

/** A row of mutually exclusive choices - the way a phone offers them. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  labels,
  onChange,
}: SegmentedControlProps<T>): React.ReactNode {
  const groupId = useId();

  return (
    <div className={styles.picker} role='radiogroup' aria-label={label}>
      {options.map((option) => (
        <label key={option} className={clsx(styles.option, value === option && styles.optionActive)}>
          <input
            className={styles.radio}
            type='radio'
            name={groupId}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {labels[option]}
        </label>
      ))}
    </div>
  );
}
