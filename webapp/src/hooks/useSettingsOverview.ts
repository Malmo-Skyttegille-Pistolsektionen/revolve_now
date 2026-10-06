import { useQuery } from '@tanstack/react-query';
import { useDiagnosticsApi } from '../api/diagnostics';
import { useEthernetApi } from '../api/ethernet';
import { useWifiApi } from '../api/wifi';
import { useSettings } from '../context/SettingsContext';
import { useT } from '../i18n';
import { formatBytes } from '../lib/format-bytes';
import { compareVersions, fetchReleases } from '../lib/release-check';
import { useControlLockStatus } from './useControlLockStatus';

/**
 * `attention` is indigo, everything else grey: green and amber belong to the
 * targets and the delay (DESIGN.md, the Three Signals Rule).
 */
export type Tone = 'attention' | 'quiet';

export interface Line {
  /** The one line under a row's title. */
  summary: string;
  /** The pill beside it, when the row has a verdict to give. */
  status?: { label: string; tone: Tone };
}

/**
 * One line per Settings row, so the page can be read from its headings (#525).
 *
 * Every query here is one a section below already makes, under the same key,
 * so the overview costs no request of its own. GitHub is asked only under
 * the Update section's own rules: `github-releases` with its staleTime and no
 * retry, and a failure reads as "not checked" rather than as a fault.
 */
export function useSettingsOverview() {
  const t = useT();
  const o = t.settings.overview;
  const { settings } = useSettings();
  const { controlLockEnabled } = useControlLockStatus();
  const diagnosticsApi = useDiagnosticsApi();
  const wifiApi = useWifiApi();
  const ethernetApi = useEthernetApi();

  const { data: diagnostics } = useQuery({ queryKey: ['diagnostics'], queryFn: diagnosticsApi.info });
  const { data: wifi } = useQuery({ queryKey: ['wifi'], queryFn: wifiApi.status });
  const { data: ethernet } = useQuery({ queryKey: ['ethernet'], queryFn: ethernetApi.status });
  const releases = useQuery({
    queryKey: ['github-releases'],
    queryFn: ({ signal }) => fetchReleases(undefined, signal),
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const running = diagnostics?.version;
  const latest = releases.data?.find((release) => !release.prerelease);
  const update: Line = {
    summary: running ?? o.checking,
    status:
      running === undefined || latest === undefined
        ? releases.isFetching
          ? undefined
          : { label: o.notChecked, tone: 'quiet' }
        : compareVersions(latest.version, running) > 0
          ? { label: o.updateAvailable(latest.version), tone: 'attention' }
          : { label: o.upToDate, tone: 'quiet' },
  };

  const wired = ethernet?.present === true && ethernet.linkUp && ethernet.ipAddress !== '';
  const bars = Math.max(0, Math.min(4, wifi?.bars ?? 0));
  const network: Line =
    wifi === undefined && ethernet === undefined
      ? { summary: o.checking }
      : wired
        ? { summary: `${o.viaEthernet} · ${ethernet.ipAddress}`, status: { label: o.viaEthernet, tone: 'quiet' } }
        : wifi?.connected === true
          ? {
              summary: `${o.viaWifi(wifi.ssid)} · ${wifi.ipAddress}`,
              status: { label: o.signal[bars], tone: bars <= 1 ? 'attention' : 'quiet' },
            }
          : { summary: o.accessPoint, status: { label: o.accessPoint, tone: 'attention' } };

  const issues = diagnostics?.startupIssues.length ?? 0;
  const startup: Line =
    diagnostics === undefined
      ? { summary: o.checking }
      : issues === 0
        ? { summary: o.startupNone, status: { label: o.noProblems, tone: 'quiet' } }
        : { summary: o.startupSome, status: { label: o.problems(issues), tone: 'attention' } };

  const lock: Line = controlLockEnabled
    ? { summary: o.lockOnSummary, status: { label: o.lockOn, tone: 'quiet' } }
    : { summary: o.lockOffSummary, status: { label: o.lockOff, tone: 'quiet' } };

  const storage: Line = {
    summary:
      diagnostics === undefined
        ? o.checking
        : o.storageUsed(formatBytes(diagnostics.storageUsedBytes), formatBytes(diagnostics.storageTotalBytes)),
  };

  const appearance: Line = {
    summary: `${o.theme[settings.theme]} · ${o.language[settings.language]}`,
  };

  return {
    update,
    network,
    startup,
    lock,
    storage,
    backup: { summary: o.backupSummary } satisfies Line,
    appearance,
    address: { summary: settings.serverBaseUrl } satisfies Line,
    about: { summary: running ?? o.checking } satisfies Line,
  };
}
