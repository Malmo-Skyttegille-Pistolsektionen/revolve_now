import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useSettings } from '../context/SettingsContext';
import { useDiagnosticsApi } from '../api/diagnostics';
import { useT } from '../i18n';
import styles from './ServerUrlSection.module.css';

function isUrlValid(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (parsed.hostname === 'localhost') return true;
    if (/(^(\d{1,3}\.){3}\d{1,3}$)/.test(parsed.hostname)) {
      return parsed.hostname.split('.').every((part) => {
        const n = Number(part);
        return n >= 0 && n <= 255;
      });
    }
    return /^[a-zA-Z0-9.-]+$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function ServerUrlSection(): React.ReactNode {
  const { settings, setServerBaseUrl } = useSettings();
  const diagnosticsApi = useDiagnosticsApi();
  const t = useT();

  // The device's own address, folded into this section's heading rather than
  // given a section of its own. It is not a setting - nothing here can change
  // it - and as its own card it read as one, under a heading shorter than the
  // value beneath it. What it is actually for is being read aloud or copied,
  // and beside the URL is where it explains something: this is the address the
  // box below should point at.
  const { data: diagnostics } = useQuery({
    queryKey: ['diagnostics'],
    queryFn: diagnosticsApi.info,
  });
  const deviceAddress = diagnostics?.ipAddress;
  const hasAddress = deviceAddress !== undefined && deviceAddress !== '';
  const [urlInput, setUrlInput] = useState(settings.serverBaseUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlSuccess, setUrlSuccess] = useState(false);

  const handleUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const value = e.target.value;
      setUrlInput(value);
      setUrlSuccess(false);

      if (!isUrlValid(value)) {
        setUrlError(t.settings.serverUrl.invalidUrl);
      } else {
        setUrlError(null);
      }
    },
    [t],
  );

  const handleUrlSave = useCallback(async (): Promise<void> => {
    if (!isUrlValid(urlInput)) {
      return;
    }

    setServerBaseUrl(urlInput);
    setUrlSuccess(true);

    setTimeout(() => {
      setUrlSuccess(false);
    }, 3000);
  }, [urlInput, setServerBaseUrl]);

  const urlChanged = urlInput !== settings.serverBaseUrl;
  const urlValid = isUrlValid(urlInput);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        {t.settings.serverUrl.title}
        {hasAddress && (
          <span className={styles.sectionTitleAside}>
            {t.settings.serverUrl.addressBefore}
            <span className={styles.address} data-testid='network-address'>
              {deviceAddress}
            </span>
            {t.settings.serverUrl.addressAfter}
          </span>
        )}
      </h2>
      <div className={styles.inputRow}>
        <input
          type='url'
          className={clsx(styles.input, urlError && styles.inputError)}
          value={urlInput}
          onChange={handleUrlChange}
          placeholder='http://localhost:8080'
        />
        <button
          className={clsx(styles.button, styles.buttonPrimary)}
          onClick={handleUrlSave}
          disabled={!urlValid || !urlChanged}
        >
          {t.common.save}
        </button>
      </div>
      {/* Kept from the section this absorbed: an empty `ipAddress` is the
          firmware saying it is on its own access point or the link dropped,
          which is a different thing from not having answered yet - and it is
          the one case where this line tells an operator something they cannot
          see from the fact the page loaded. */}
      {diagnostics !== undefined && !hasAddress && (
        <div className={styles.addressMissing} data-testid='network-address-missing'>
          {t.settings.serverUrl.noAddress}
        </div>
      )}
      {urlError && <div className={styles.errorMessage}>{urlError}</div>}
      {urlSuccess && <div className={styles.successMessage}>{t.settings.serverUrl.saved}</div>}
    </section>
  );
}
