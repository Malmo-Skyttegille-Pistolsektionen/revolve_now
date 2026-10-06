import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useDiagnosticsApi } from '../api/diagnostics';
import { useHardwareConfigApi, type HardwareConfigPatch } from '../api/hardwareConfig';
import type { HardwareConfig } from '../api/types';
import { useSettings } from '../context/SettingsContext';
import { useControlLockStatus } from '../hooks/useControlLockStatus';
import { useT } from '../i18n';
import { BANK_LETTERS } from '../lib/program-document';
import styles from './HardwareSection.module.css';

/**
 * The hardware a device is configured for (#144) — the answer to "where does a
 * club configure their device", which until now was "curl, or not at all".
 *
 * On its own page (`/hardware`), reached by a button on Settings and absent
 * from the main navigation. Everything on Settings is recoverable from the page
 * you broke it on; these values are not. A wrong GPIO drives nothing, and a
 * wrong hostname changes mDNS so the device stops answering to the name people
 * reach it by — which is worse, because a wrong pin at least leaves the web app
 * reachable to fix it from.
 *
 * Two rules it exists to make visible:
 *
 *  - **Nothing here takes effect until the device restarts.** A pin change that
 *    appears to have done nothing is how somebody ends up reflashing a working
 *    device, so a pending change is stated rather than left to be noticed.
 *  - **Where the targets rest at boot is not editable here.** It is shown,
 *    because an operator needs to know it, and it changes only from the serial
 *    console (D-31).
 *
 * Grouped by the thing each pin belongs to rather than listed flat: somebody
 * here is adapting the firmware to a board they have in front of them, and they
 * work through it one peripheral at a time.
 */

/**
 * Every numeric field is a GPIO or a port, and they behave identically. The
 * label and hint live in the dictionary under the same key.
 */
type NumericField = {
  key: keyof HardwareConfigPatch &
    (
      | 'ledGpio'
      | 'i2sPort'
      | 'i2sBckGpio'
      | 'i2sWsGpio'
      | 'i2sDoutGpio'
      | 'i2sMclkGpio'
      | 'ethCsGpio'
      | 'ethSclkGpio'
      | 'ethMosiGpio'
      | 'ethMisoGpio'
      | 'ethIntGpio'
      | 'ethRstGpio'
      | 'httpPort'
      | 'wifiMaxRetries'
    );
  testId: string;
};

/**
 * A bank row with no pin typed yet. Not 0, which is a real GPIO the device
 * refuses (BOOT/strapping), and not `null`, which the contract has no room
 * for - so it never leaves this component: Save is disabled until every row
 * carries a pin.
 */
const NO_PIN = Number.NaN;

/** `rt::kMaxTargetBanks` and `rt::kMaxBankNameLength`. */
const MAX_BANKS = 8;
const MAX_BANK_NAME = 16;

type TargetBank = HardwareConfig['banks'][number];

const LED_FIELDS: NumericField[] = [{ key: 'ledGpio', testId: 'hardware-led-gpio' }];

const AUDIO_FIELDS: NumericField[] = [
  { key: 'i2sPort', testId: 'hardware-i2s-port' },
  { key: 'i2sBckGpio', testId: 'hardware-i2s-bck' },
  { key: 'i2sWsGpio', testId: 'hardware-i2s-ws' },
  { key: 'i2sDoutGpio', testId: 'hardware-i2s-dout' },
  { key: 'i2sMclkGpio', testId: 'hardware-i2s-mclk' },
];

/** An on/off setting (#262). Label and hint live in the dictionary under the key. */
type ToggleField = {
  key: keyof HardwareConfigPatch & ('wifiEnabled' | 'ethEnabled');
  testId: string;
};

const ETHERNET_FIELDS: NumericField[] = [
  { key: 'ethCsGpio', testId: 'hardware-eth-cs' },
  { key: 'ethSclkGpio', testId: 'hardware-eth-sclk' },
  { key: 'ethMosiGpio', testId: 'hardware-eth-mosi' },
  { key: 'ethMisoGpio', testId: 'hardware-eth-miso' },
  { key: 'ethIntGpio', testId: 'hardware-eth-int' },
  { key: 'ethRstGpio', testId: 'hardware-eth-rst' },
];

const NETWORK_FIELDS: NumericField[] = [
  { key: 'httpPort', testId: 'hardware-http-port' },
  { key: 'wifiMaxRetries', testId: 'hardware-wifi-retries' },
];

export function HardwareSection(): React.ReactNode {
  const t = useT().hardware;
  const { controlLockToken } = useSettings();
  const { controlLockEnabled } = useControlLockStatus();
  const api = useHardwareConfigApi();
  const diagnosticsApi = useDiagnosticsApi();
  const queryClient = useQueryClient();

  // Same rule as the rest of the app: the lock off means anyone may manage.
  const canManage = !controlLockEnabled || controlLockToken !== null;

  const [draft, setDraft] = useState<HardwareConfigPatch | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: state } = useQuery({
    queryKey: ['hardware-config'],
    queryFn: api.get,
  });

  // Already fetched by TroubleshootingSection on this page, so the pad
  // read-back costs nothing extra. It is the column that says whether the pin
  // just typed is actually driving anything.
  const { data: diagnostics } = useQuery({
    queryKey: ['diagnostics'],
    queryFn: diagnosticsApi.info,
  });

  const save = useMutation({
    mutationFn: (patch: HardwareConfigPatch) => api.save(patch),
    onSuccess: async (result) => {
      setDraft(null);
      setNotice(result.message);
      await queryClient.invalidateQueries({ queryKey: ['hardware-config'] });
    },
    // RFC 9457 (D-19): the device's `detail` is the sentence written for this
    // situation — which GPIO, and why it is refused — so it is shown as-is.
    onError: (error: Error) => setNotice(error.message),
  });

  const reset = useMutation({
    mutationFn: () => api.reset(),
    onSuccess: async (result) => {
      setDraft(null);
      setNotice(result.message);
      await queryClient.invalidateQueries({ queryKey: ['hardware-config'] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  if (!state) {
    return (
      <section className={styles.section} data-testid='hardware-section'>
        <h2 className={styles.sectionTitle}>{t.title}</h2>
        <p className={styles.explain}>{t.loading}</p>
      </section>
    );
  }

  const saved = state.saved;
  const value = <K extends keyof HardwareConfigPatch>(key: K): NonNullable<HardwareConfigPatch[K]> =>
    (draft?.[key] ?? saved[key]) as NonNullable<HardwareConfigPatch[K]>;

  const set = <K extends keyof HardwareConfigPatch>(key: K, next: HardwareConfigPatch[K]): void => {
    setNotice(null);
    setDraft({ ...draft, [key]: next });
  };

  const savedBanks = saved.banks;
  const defaultBanks = state.defaults.banks;
  const banks: TargetBank[] = draft?.banks ?? savedBanks;

  const setBanks = (next: TargetBank[]): void => {
    setNotice(null);
    setDraft({ ...draft, banks: next });
  };

  const editBank = (index: number, change: Partial<TargetBank>): void => {
    setBanks(banks.map((bank, i) => (i === index ? { ...bank, ...change } : bank)));
  };

  // Only what changed. The device keeps any field the request does not carry,
  // so this is also what stops a stale form overwriting a value another client
  // set while it was open.
  const patch: HardwareConfigPatch = {};
  if (draft) {
    for (const key of Object.keys(draft) as (keyof HardwareConfigPatch)[]) {
      // `banks` is an array: a new one is never `===` the stored one, so it
      // needs a value comparison or every render would look dirty.
      if (key === 'banks') continue;
      if (draft[key] !== saved[key]) (patch as Record<string, unknown>)[key] = draft[key];
    }
    // Sent whole: the array is ordered, so there is no partial merge of one.
    if (JSON.stringify(draft.banks ?? savedBanks) !== JSON.stringify(savedBanks)) {
      patch.banks = banks;
    }
  }
  const dirty = Object.keys(patch).length > 0;
  const busy = save.isPending || reset.isPending;
  // A row still waiting for its pin is not a configuration the device could
  // accept, so Save waits rather than sending a body that comes back 400.
  const bankPinMissing = banks.some((bank) => !Number.isFinite(bank.gpio));

  /** Marks a field whose stored value is not the compiled default. */
  const overridden = (key: keyof HardwareConfig): boolean => saved[key] !== state.defaults[key];

  const numeric = (field: NumericField): React.ReactNode => (
    <label className={styles.field} key={field.key}>
      <span className={styles.label}>
        {t.fields[field.key].label}
        {overridden(field.key) && <span className={styles.badge}>{t.changed}</span>}
      </span>
      <input
        className={styles.input}
        type='text'
        inputMode='numeric'
        data-testid={field.testId}
        disabled={!canManage || busy}
        value={String(value(field.key))}
        onChange={(e) => {
          set(field.key, Number(e.target.value));
        }}
      />
      <span className={styles.hint}>{t.fields[field.key].hint}</span>
    </label>
  );

  const toggle = (field: ToggleField): React.ReactNode => (
    <label className={styles.field} key={field.key}>
      <span className={styles.checkboxRow}>
        <input
          type='checkbox'
          data-testid={field.testId}
          disabled={!canManage || busy}
          checked={value(field.key)}
          onChange={(e) => {
            set(field.key, e.target.checked);
          }}
        />
        <span className={styles.label}>
          {t.fields[field.key].label}
          {overridden(field.key) && <span className={styles.badge}>{t.changed}</span>}
        </span>
      </span>
      <span className={styles.hint}>{t.fields[field.key].hint}</span>
    </label>
  );

  const group = (title: string, testId: string, children: React.ReactNode): React.ReactNode => (
    <div className={styles.group} data-testid={testId}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <div className={styles.fields}>{children}</div>
    </div>
  );

  return (
    <section className={clsx(styles.section, styles.expert)} data-testid='hardware-section'>
      <div className={styles.head}>
        <h2 className={styles.sectionTitle}>{t.title}</h2>
      </div>

      <p className={styles.explain}>
        {t.explainBefore}
        <strong>{t.explainWarning}</strong>
        {t.explainAfter}
      </p>

      {state.restartRequired && (
        <p className={styles.pending} data-testid='hardware-restart-required'>
          {t.restartRequiredBefore}
          <strong>{t.restartRequiredNotInUse}</strong>
          {t.restartRequiredMiddle}
          <strong>{t.restartRequiredAction}</strong>
          {t.restartRequiredAfter}
        </p>
      )}

      <>
        {group(
          t.groups.targets,
          'hardware-group-targets',
          <>
            {/* A table rather than a repeated field group: every bank has the
                  same four values, and the question somebody has here is "which
                  pin is bank C on", which reads off a column. */}
            <div className={styles.tableScroll}>
              <table className={styles.bankTable} data-testid='hardware-bank-table'>
                <thead>
                  <tr>
                    <th scope='col'>{t.banks.columnBank}</th>
                    <th scope='col'>
                      {t.banks.columnName} <span className={styles.thHint}>{t.banks.columnNameHint}</span>
                    </th>
                    <th scope='col'>{t.banks.columnGpio}</th>
                    <th scope='col'>{t.banks.columnShownWhenLow}</th>
                    <th scope='col'>{t.banks.columnPadNow}</th>
                    <th scope='col'>
                      <span className={styles.srOnly}>{t.banks.columnRemove}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {banks.map((bank, index) => {
                    const letter = BANK_LETTERS[index];
                    // Only the last bank goes: the letter is the position,
                    // so a gap re-aims the banks after it. Why, in
                    // `docs/site/expert-mode.md`.
                    const removable = index > 0 && index === banks.length - 1;
                    // Same "changed" marker every other field carries, so
                    // "Reset to defaults" says what it would undo. A bank the
                    // compiled defaults do not have is changed by existing.
                    const asShipped = defaultBanks[index];
                    const changed =
                      asShipped === undefined ||
                      asShipped.gpio !== bank.gpio ||
                      asShipped.activeLow !== bank.activeLow ||
                      asShipped.name !== bank.name;
                    const pad = diagnostics?.banks?.[index]?.padLevel;
                    return (
                      <tr key={index} data-testid={`hardware-bank-row-${letter}`}>
                        <th scope='row' className={styles.bankLetter}>
                          {letter}
                          {changed && (
                            <span className={styles.badge} data-testid={`hardware-bank-changed-${letter}`}>
                              {t.changed}
                            </span>
                          )}
                        </th>
                        <td>
                          <input
                            className={styles.input}
                            type='text'
                            maxLength={MAX_BANK_NAME}
                            aria-label={t.banks.nameLabel(letter)}
                            data-testid={`hardware-bank-name-${letter}`}
                            disabled={!canManage || busy}
                            value={bank.name}
                            onChange={(e) => {
                              editBank(index, { name: e.target.value });
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className={clsx(styles.input, styles.gpioInput)}
                            type='text'
                            inputMode='numeric'
                            aria-label={t.banks.gpioLabel(letter)}
                            data-testid={`hardware-bank-gpio-${letter}`}
                            disabled={!canManage || busy}
                            value={Number.isFinite(bank.gpio) ? String(bank.gpio) : ''}
                            onChange={(e) => {
                              // An empty or non-numeric field is "not typed
                              // yet", never 0 - `Number('')` is 0, which is a
                              // pin, and the row would silently claim it.
                              const typed = e.target.value.trim();
                              editBank(index, {
                                gpio: /^\d+$/.test(typed) ? Number(typed) : NO_PIN,
                              });
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type='checkbox'
                            aria-label={t.banks.shownWhenLowLabel(letter)}
                            data-testid={`hardware-bank-active-low-${letter}`}
                            disabled={!canManage || busy}
                            checked={bank.activeLow}
                            onChange={(e) => {
                              editBank(index, { activeLow: e.target.checked });
                            }}
                          />
                        </td>
                        {/* Read back through the input buffer, so a pin that
                              is not moving says so without a multimeter. Blank
                              until diagnostics have been fetched, and for a
                              draft row past the last bank the device has. */}
                        <td className={styles.padCell} data-testid={`hardware-bank-pad-${letter}`}>
                          {pad === undefined ? '—' : pad === 1 ? t.banks.padHigh : t.banks.padLow}
                        </td>
                        <td>
                          <button
                            className={styles.removeBank}
                            type='button'
                            data-testid={`hardware-bank-remove-${letter}`}
                            disabled={!canManage || busy || !removable}
                            title={
                              index === 0
                                ? t.banks.cannotRemoveFirst
                                : removable
                                  ? t.banks.removeLabel(letter)
                                  : t.banks.removeLastFirst
                            }
                            aria-label={t.banks.removeLabel(letter)}
                            onClick={() => {
                              setBanks(banks.slice(0, -1));
                            }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {bankPinMissing && (
              <span className={styles.hint} data-testid='hardware-bank-pin-missing'>
                {t.banks.pinMissing}
              </span>
            )}

            <div className={styles.bankActions}>
              {banks.length < MAX_BANKS ? (
                <button
                  className={styles.button}
                  type='button'
                  data-testid='hardware-bank-add'
                  disabled={!canManage || busy}
                  onClick={() => {
                    // No pin, not 0: GPIO0 is the BOOT strapping pin and is
                    // always refused, so seeding it would mean a new row is
                    // born holding a value the device will not take. The
                    // polarity copies the last bank's, which is nearly always
                    // right - banks on one device are wired the same way.
                    setBanks([...banks, { gpio: NO_PIN, activeLow: banks[banks.length - 1].activeLow, name: '' }]);
                  }}
                >
                  {t.banks.add(BANK_LETTERS[banks.length])}
                </button>
              ) : (
                <span className={styles.hint} data-testid='hardware-bank-limit'>
                  {t.banks.limit}
                </span>
              )}
            </div>

            <span className={styles.hint}>{t.banks.pinsHint}</span>

            {/* Shown, not editable. An operator needs to know where the
                  targets rest at boot; changing it needs physical access,
                  because it is what protects somebody standing downrange
                  (D-31). */}
            <div className={styles.field}>
              <span className={styles.label}>{t.bootTargets.label}</span>
              <p className={styles.readOnlyValue} data-testid='hardware-boot-targets'>
                {state.active.targetsShownAtBoot ? t.bootTargets.shown : t.bootTargets.hidden}
              </p>
              <span className={styles.hint}>
                {t.bootTargets.hintBefore}
                <code>boot-targets shown</code>
                {t.bootTargets.hintOr}
                <code>boot-targets hidden</code>
                {t.bootTargets.hintAfter}
              </span>
            </div>
          </>,
        )}

        {group(t.groups.led, 'hardware-group-led', LED_FIELDS.map(numeric))}

        {group(t.groups.audio, 'hardware-group-audio', AUDIO_FIELDS.map(numeric))}

        {group(
          t.groups.ethernet,
          'hardware-group-ethernet',
          <>
            {toggle({ key: 'ethEnabled', testId: 'hardware-eth-enabled' })}
            {ETHERNET_FIELDS.map(numeric)}
          </>,
        )}

        {group(
          t.groups.network,
          'hardware-group-network',
          <>
            <label className={styles.field}>
              <span className={styles.label}>
                {t.hostname.label}
                {overridden('hostname') && <span className={styles.badge}>{t.changed}</span>}
              </span>
              <input
                className={styles.input}
                type='text'
                data-testid='hardware-hostname'
                disabled={!canManage || busy}
                value={value('hostname')}
                onChange={(e) => {
                  set('hostname', e.target.value);
                }}
              />
              <span className={styles.hint}>
                {t.hostname.hintBefore}
                <code>{value('hostname') || '…'}.local</code>
                {t.hostname.hintMiddle}
                <code>{value('hostname') || '…'}-setup-XXXX</code>
                {t.hostname.hintAfter}
              </span>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>
                {t.displayName.label}
                {overridden('displayName') && <span className={styles.badge}>{t.changed}</span>}
              </span>
              <input
                className={styles.input}
                type='text'
                data-testid='hardware-display-name'
                disabled={!canManage || busy}
                value={value('displayName')}
                onChange={(e) => {
                  set('displayName', e.target.value);
                }}
              />
              <span className={styles.hint}>{t.displayName.hint}</span>
            </label>

            {toggle({ key: 'wifiEnabled', testId: 'hardware-wifi-enabled' })}
            {NETWORK_FIELDS.map(numeric)}
          </>,
        )}

        <div className={styles.actions}>
          <button
            className={clsx(styles.button, styles.buttonPrimary)}
            data-testid='hardware-save'
            disabled={!canManage || !dirty || busy || bankPinMissing}
            onClick={() => {
              save.mutate(patch);
            }}
          >
            {t.save}
          </button>
          <button
            className={styles.button}
            data-testid='hardware-revert'
            disabled={!dirty || busy}
            onClick={() => {
              setDraft(null);
              setNotice(null);
            }}
          >
            {t.discard}
          </button>
          <button
            className={clsx(styles.button, styles.buttonDanger)}
            data-testid='hardware-reset'
            disabled={!canManage || !state.overridden || busy}
            onClick={() => {
              reset.mutate();
            }}
          >
            {t.resetDefaults}
          </button>
        </div>

        {!canManage && (
          <p className={styles.hint} data-testid='hardware-locked'>
            {t.locked}
          </p>
        )}

        <p className={styles.hint}>{t.restartHint}</p>
      </>

      {notice && (
        <p className={styles.notice} data-testid='hardware-notice'>
          {notice}
        </p>
      )}
    </section>
  );
}
