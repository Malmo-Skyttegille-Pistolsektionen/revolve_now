import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ReleaseCheckError,
  compareVersions,
  fetchReleases,
  formatCheckedAt,
  parseReleases,
  releaseOf,
  sha256OfFile,
} from '../src/lib/release-check';

const REPO = 'o/r';
const HASH = 'eb98806bdd39db747a39e58ec20d6621dbefd4cb81db9dcc9582b1a433af4531';

function apiRelease(tag: string, extra: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    body: `## ${tag}`,
    published_at: '2026-10-06T08:57:31Z',
    prerelease: false,
    draft: false,
    html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
    assets: [
      {
        name: `revolve_now-${tag}-ota.bin`,
        browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/revolve_now-${tag}-ota.bin`,
        size: 3_522_224,
        digest: `sha256:${HASH.toUpperCase()}`,
      },
    ],
    ...extra,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('versions', () => {
  it('reads the release a git describe string starts from', () => {
    expect(releaseOf('0.1.0')).toEqual([0, 1, 0]);
    expect(releaseOf('0.1.0-3-gab12cde')).toEqual([0, 1, 0]);
    expect(releaseOf('0.1.0-dirty')).toEqual([0, 1, 0]);
    expect(releaseOf('ab12cde')).toBeNull();
  });

  it('compares numerically, and puts a build that is not a release below every release', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0-3-gab12cde')).toBe(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareVersions('0.1.0', 'ab12cde')).toBeGreaterThan(0);
    expect(compareVersions('ab12cde', 'ab12cde')).toBe(0);
  });
});

describe('parseReleases', () => {
  it('lists releases newest first, with the OTA asset and its lowercased digest', () => {
    const releases = parseReleases([apiRelease('0.1.0'), apiRelease('0.10.0'), apiRelease('0.2.0')], REPO);
    expect(releases.map((release) => release.version)).toEqual(['0.10.0', '0.2.0', '0.1.0']);
    expect(releases[2].ota).toEqual({
      name: 'revolve_now-0.1.0-ota.bin',
      downloadUrl: `https://github.com/${REPO}/releases/download/0.1.0/revolve_now-0.1.0-ota.bin`,
      size: 3_522_224,
      sha256: HASH,
    });
  });

  it('skips drafts and tags that are not releases', () => {
    const releases = parseReleases(
      [apiRelease('0.1.0', { draft: true }), apiRelease('v0.2.0'), apiRelease('0.3.0-rc.1'), apiRelease('0.4.0')],
      REPO,
    );
    expect(releases.map((release) => release.version)).toEqual(['0.4.0']);
  });

  it('lists a release it cannot install, without an OTA asset', () => {
    const noDigest = apiRelease('0.1.0');
    noDigest.assets[0].digest = null as unknown as string;
    const elsewhere = apiRelease('0.2.0');
    elsewhere.assets[0].browser_download_url = 'https://example.com/revolve_now-0.2.0-ota.bin';
    const releases = parseReleases([noDigest, elsewhere, apiRelease('0.3.0', { assets: [] })], REPO);
    expect(releases.map((release) => release.ota)).toEqual([null, null, null]);
  });

  it('refuses an answer that is not a list', () => {
    expect(() => parseReleases({ message: 'Not Found' }, REPO)).toThrow(ReleaseCheckError);
  });
});

describe('fetchReleases', () => {
  it('asks the releases API of the repository', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([apiRelease('0.1.0')])));
    expect((await fetchReleases(REPO)).map((release) => release.version)).toEqual(['0.1.0']);
    expect(spy.mock.calls[0][0]).toBe(`https://api.github.com/repos/${REPO}/releases?per_page=30`);
  });

  it('tells an unreachable GitHub from a rate limit from anything else', async () => {
    const kind = async (): Promise<string> => {
      try {
        await fetchReleases(REPO);
        return 'none';
      } catch (error) {
        return (error as ReleaseCheckError).kind;
      }
    };
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await kind()).toBe('unreachable');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    );
    expect(await kind()).toBe('rate-limited');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 500 }));
    expect(await kind()).toBe('failed');
  });
});

describe('sha256OfFile', () => {
  it('hashes the bytes of a picked file', async () => {
    expect(await sha256OfFile(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('formatCheckedAt', () => {
  it('gives the date and the time, 24-hour', () => {
    expect(formatCheckedAt(new Date(2026, 9, 6, 9, 5).getTime())).toBe('2026-10-06 09:05');
  });
});
