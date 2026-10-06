#!/usr/bin/env python3
"""Say which areas a pull request touches, so required jobs can skip their work.

    changed_areas.py >> "$GITHUB_OUTPUT"

Prints `firmware=`, `webapp=`, `contracts=` and `e2e=` as `true` or `false`.
The required jobs keep running and reporting under their names (AGENTS.md);
only their steps are skipped, and only on an explicit `false`.

Conservative by construction: a path no rule below names counts as touching
everything, and so does any event other than `pull_request` (push to main and
release.yml's `workflow_call` always run the lot). For a pull request the diff
is the checked-out merge commit against its first parent - exactly what the PR
adds to the base it would merge into - so the checkout needs `fetch-depth: 2`.
"""

from __future__ import annotations

import os
import subprocess
import sys

AREAS = ("firmware", "webapp", "contracts")
ALL = frozenset(AREAS)
NONE: frozenset[str] = frozenset()

# First match wins. A trailing `/` is a directory prefix, anything else an
# exact path.
RULES: list[tuple[str, frozenset[str]]] = [
    # The seams: CI itself, the API both sides implement, and the shipped
    # content that the firmware embeds, the webapp tests read and the contracts
    # job validates.
    (".github/", ALL),
    ("contracts/", ALL),
    ("resources/", ALL),
    (".oasdiff.yaml", frozenset({"contracts"})),
    (".oasdiff-levels.txt", frozenset({"contracts"})),
    # Prose inside firmware/ that no build reads. Markdown under webapp/ is not
    # listed: webapp/test/theme-tokens.test.ts reads DESIGN.md.
    ("firmware/docs/", NONE),
    ("firmware/AGENTS.md", NONE),
    ("firmware/CONTRIBUTING.md", NONE),
    ("firmware/README.md", NONE),
    ("firmware/SECURITY.md", NONE),
    ("firmware/", frozenset({"firmware"})),
    ("webapp/", frozenset({"webapp"})),
    # Built by pages.yml or checked by lint.yml, both of which always run when
    # these change.
    ("docs/", NONE),
    ("hardware/", NONE),
    ("mkdocs.yml", NONE),
    (".pre-commit-config.yaml", NONE),
    (".mcp.json", NONE),
    (".impeccable/", NONE),
    ("AGENTS.md", NONE),
    ("CLAUDE.md", NONE),
    ("CONTRIBUTING.md", NONE),
    ("README.md", NONE),
    ("LICENSE", NONE),
    ("DCO", NONE),
]


def areas_for(path: str) -> frozenset[str]:
    for rule, areas in RULES:
        if path == rule or (rule.endswith("/") and path.startswith(rule)):
            return areas
    return ALL


def touched(paths: list[str]) -> dict[str, bool]:
    hit: set[str] = set()
    for path in paths:
        hit |= areas_for(path)
    result = {area: area in hit for area in AREAS}
    # The E2E suite boots the firmware with the webapp baked in, so either
    # side can break it.
    result["e2e"] = result["firmware"] or result["webapp"]
    return result


def changed_paths() -> list[str] | None:
    """The PR's paths, or None when they cannot be known for certain."""
    if os.environ.get("GITHUB_EVENT_NAME") != "pull_request":
        return None
    # A checkout that is not the merge commit has no first parent to diff
    # against that means "the base".
    if subprocess.run(["git", "rev-parse", "-q", "--verify", "HEAD^2"], capture_output=True).returncode:
        return None
    # --no-renames: a file moved out of firmware/ is a firmware change too.
    out = subprocess.run(
        ["git", "diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return out.splitlines()


def main() -> int:
    paths = changed_paths()
    if paths is None:
        result = dict.fromkeys((*AREAS, "e2e"), True)
        print("Not a pull request merge commit - running everything.", file=sys.stderr)
    else:
        result = touched(paths)
        for path in paths:
            print(f"  {path}: {', '.join(sorted(areas_for(path))) or '-'}", file=sys.stderr)
    for area, value in result.items():
        print(f"{area}={'true' if value else 'false'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
