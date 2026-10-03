#!/usr/bin/env python3
"""Write the SHA-256 of a bumped git-cliff into setup-git-cliff's action.yml.

Renovate bumps the action's `version` default but cannot compute the digest
beside it (#417). This downloads the tarball for the new version, refuses it
unless it matches upstream's published `.sha512`, and writes its SHA-256.

Only a version *change* against the PR's base is acted on. When the version is
unchanged the pinned digest is left alone, mismatch or not: rewriting it then
would accept a release asset that was replaced upstream, which is the very
thing the pin exists to catch.

Usage: pin_git_cliff_digest.py <action.yml> <base action.yml>
"""

from __future__ import annotations

import hashlib
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

VERSION_RE = re.compile(r'depName=orhun/git-cliff\s+default: "([^"]+)"')
DIGEST_RE = re.compile(r'(?ms)^  sha256:\n.*?^    default: "([0-9a-f]{64})"')
URL = (
    "https://github.com/orhun/git-cliff/releases/download/"
    "v{v}/git-cliff-{v}-x86_64-unknown-linux-gnu.tar.gz"
)


def field(regex: re.Pattern[str], text: str, what: str, path: Path) -> re.Match[str]:
    match = regex.search(text)
    if not match:
        sys.exit(f"::error::{path}: cannot find the git-cliff {what}.")
    return match


def fetch(url: str) -> bytes:
    # Release downloads answer 503 now and then; retry rather than fail the PR.
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as err:
            if err.code < 500 or attempt == 4:
                raise
        except urllib.error.URLError:
            if attempt == 4:
                raise
        time.sleep(2**attempt)
    raise AssertionError("unreachable")


def main() -> None:
    action, base = Path(sys.argv[1]), Path(sys.argv[2])
    text = action.read_text()
    version = field(VERSION_RE, text, "version", action).group(1)
    base_version = field(VERSION_RE, base.read_text(), "version", base).group(1)
    digest = field(DIGEST_RE, text, "sha256", action)

    if version == base_version:
        print(f"git-cliff stays at {version}; the digest is left as pinned.")
        return

    url = URL.format(v=version)
    tarball = fetch(url)
    published = fetch(url + ".sha512").decode().split()[0].lower()
    actual = hashlib.sha512(tarball).hexdigest()
    if actual != published:
        sys.exit(
            f"::error::git-cliff {version}: the tarball does not match upstream's .sha512.\n"
            f"::error::  published: {published}\n"
            f"::error::  actual:    {actual}"
        )

    sha256 = hashlib.sha256(tarball).hexdigest()
    if sha256 == digest.group(1):
        print(f"git-cliff {version}: the pinned digest is already correct.")
        return
    start, end = digest.span(1)
    action.write_text(text[:start] + sha256 + text[end:])
    print(f"git-cliff {base_version} -> {version}: sha256 {sha256}, verified against upstream's .sha512.")


if __name__ == "__main__":
    main()
