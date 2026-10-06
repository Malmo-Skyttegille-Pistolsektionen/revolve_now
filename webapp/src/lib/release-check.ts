/**
 * Which releases GitHub has, for Settings → Update (#518, D-47).
 *
 * The browser does all of it. GitHub's releases API is CORS-enabled, so a page
 * can read every release, its notes, and the SHA-256 GitHub publishes for each
 * asset; the asset *bytes* are not (their host sends no CORS header), so the
 * page links the file for an ordinary download and checks what comes back
 * against that SHA-256 before uploading it. The device never talks to GitHub.
 */
/** The repository releases are published from (D-29). */
export const RELEASE_REPO = 'Malmo-Skyttegille-Pistolsektionen/revolve_now';

/**
 * The first release with this page. A device taken below it loses the update
 * check and can only come back through the file upload.
 */
export const FIRST_IN_APP_UPDATE = '0.2.0';

/** A release tag as D-29 cuts them: bare three-part semver. */
const RELEASE_TAG = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;

export interface OtaAsset {
  name: string;
  downloadUrl: string;
  size: number;
  /** Lowercase hex, as GitHub published it. */
  sha256: string;
}

export interface Release {
  version: string;
  publishedAt: string;
  notes: string;
  prerelease: boolean;
  pageUrl: string;
  /** Null when the release has no `-ota.bin` with a published SHA-256: listed, not installable. */
  ota: OtaAsset | null;
}

export type ReleaseCheckFailure = 'unreachable' | 'rate-limited' | 'failed';

export class ReleaseCheckError extends Error {
  readonly kind: ReleaseCheckFailure;
  constructor(kind: ReleaseCheckFailure) {
    super(kind);
    this.name = 'ReleaseCheckError';
    this.kind = kind;
  }
}

/**
 * The `X.Y.Z` a `git describe` string starts with: `0.1.0`, `0.1.0-3-gab12cde`
 * and `0.1.0-dirty` all give `[0, 1, 0]`. Null for anything else, which is
 * what an untagged build reports.
 */
export function releaseOf(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:$|[-+])/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * Negative when `a` is older than `b`. A version that is not a release sorts
 * below every release, so an untagged device is offered any of them.
 */
export function compareVersions(a: string, b: string): number {
  const x = releaseOf(a);
  const y = releaseOf(b);
  if (x === null || y === null) return (x === null ? 0 : 1) - (y === null ? 0 : 1);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

interface ApiAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  digest?: unknown;
}

interface ApiRelease {
  tag_name?: unknown;
  body?: unknown;
  published_at?: unknown;
  prerelease?: unknown;
  draft?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

function otaAssetOf(release: ApiRelease, version: string, repo: string): OtaAsset | null {
  const name = `revolve_now-${version}-ota.bin`;
  const assets = Array.isArray(release.assets) ? (release.assets as ApiAsset[]) : [];
  const asset = assets.find((candidate) => candidate.name === name);
  if (asset === undefined) return null;
  const digest = typeof asset.digest === 'string' ? /^sha256:([0-9a-fA-F]{64})$/.exec(asset.digest) : null;
  const url = asset.browser_download_url;
  // The link is opened by the user's browser, so it has to be the release's
  // own download URL and nothing a crafted response could point elsewhere.
  if (digest === null || typeof url !== 'string' || !url.startsWith(`https://github.com/${repo}/releases/download/`)) {
    return null;
  }
  return {
    name,
    downloadUrl: url,
    size: typeof asset.size === 'number' ? asset.size : 0,
    sha256: digest[1].toLowerCase(),
  };
}

/** The API's answer, as releases, newest first. Drafts and tags that are not releases are skipped. */
export function parseReleases(payload: unknown, repo: string = RELEASE_REPO): Release[] {
  if (!Array.isArray(payload)) throw new ReleaseCheckError('failed');
  const releases: Release[] = [];
  for (const raw of payload as ApiRelease[]) {
    if (typeof raw !== 'object' || raw === null || raw.draft === true) continue;
    if (typeof raw.tag_name !== 'string' || !RELEASE_TAG.test(raw.tag_name)) continue;
    const version = raw.tag_name;
    releases.push({
      version,
      publishedAt: typeof raw.published_at === 'string' ? raw.published_at : '',
      notes: typeof raw.body === 'string' ? raw.body : '',
      prerelease: raw.prerelease === true,
      pageUrl: typeof raw.html_url === 'string' ? raw.html_url : `https://github.com/${repo}/releases/tag/${version}`,
      ota: otaAssetOf(raw, version, repo),
    });
  }
  return releases.sort((a, b) => compareVersions(b.version, a.version));
}

/** `GET /repos/{repo}/releases`, the 30 most recent. */
export async function fetchReleases(repo: string = RELEASE_REPO, signal?: AbortSignal): Promise<Release[]> {
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal,
    });
  } catch {
    throw new ReleaseCheckError('unreachable');
  }
  if (response.status === 403 || response.status === 429) {
    throw new ReleaseCheckError(response.headers.get('x-ratelimit-remaining') === '0' ? 'rate-limited' : 'failed');
  }
  if (!response.ok) throw new ReleaseCheckError('failed');
  return parseReleases(await response.json(), repo);
}

/** When a check was made, in this browser's clock: `2026-10-06 14:32`, the same in both languages. */
export function formatCheckedAt(at: number): string {
  const when = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(when.getFullYear())}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/** Lowercase hex SHA-256 of a file the user picked. `crypto.subtle` needs https; the device serves http. */
export async function sha256OfFile(file: Blob): Promise<string> {
  // Loaded here, not at the top: only this page needs it.
  const [{ sha256 }, { bytesToHex }] = await Promise.all([
    import('@noble/hashes/sha2.js'),
    import('@noble/hashes/utils.js'),
  ]);
  return bytesToHex(sha256(new Uint8Array(await file.arrayBuffer())));
}
