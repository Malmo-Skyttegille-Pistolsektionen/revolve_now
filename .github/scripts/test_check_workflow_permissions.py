"""check_workflow_permissions.py on fixture workflow trees, one passing and one failing."""

import textwrap
from pathlib import Path

import pytest

import check_workflow_permissions as check

CALLEE = """\
name: callee
on: workflow_call
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
  comment:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps: [{run: "true"}]
"""


def tree(root: Path, caller: str) -> None:
    workflows = root / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "callee.yml").write_text(CALLEE)
    (workflows / "caller.yml").write_text(textwrap.dedent(caller))


@pytest.fixture
def in_tmp(tmp_path, monkeypatch):
    # The checker reads `.github/workflows` from the working directory.
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_a_caller_granting_what_the_callee_needs_passes(in_tmp, capsys):
    tree(
        in_tmp,
        """\
        on: push
        permissions:
          contents: read
        jobs:
          call:
            uses: ./.github/workflows/callee.yml
            permissions:
              contents: read
              pull-requests: write
        """,
    )
    assert check.main() == 0
    assert "sufficient" in capsys.readouterr().out


def test_a_caller_granting_less_than_a_callee_job_requests_fails(in_tmp, capsys):
    # #213: the job-level request is checked even though the job would never run.
    tree(
        in_tmp,
        """\
        on: push
        jobs:
          call:
            uses: ./.github/workflows/callee.yml
            permissions:
              contents: read
        """,
    )
    assert check.main() == 1
    out = capsys.readouterr().out
    assert "pull-requests: none" in out and "`comment` requests pull-requests: write" in out


def test_read_all_is_read_for_every_scope(in_tmp, capsys):
    tree(
        in_tmp,
        """\
        on: push
        permissions: read-all
        jobs:
          call:
            uses: ./.github/workflows/callee.yml
        """,
    )
    assert check.main() == 1
    assert "`comment` requests pull-requests: write" in capsys.readouterr().out


def test_write_all_covers_everything(in_tmp):
    tree(
        in_tmp,
        """\
        on: push
        jobs:
          call:
            uses: ./.github/workflows/callee.yml
            permissions: write-all
        """,
    )
    assert check.main() == 0


def test_an_unwritten_grant_is_reported_not_assumed(in_tmp, capsys):
    tree(
        in_tmp,
        """\
        on: push
        jobs:
          call:
            uses: ./.github/workflows/callee.yml
        """,
    )
    assert check.main() == 1
    assert "without an explicit `permissions:` block" in capsys.readouterr().out


def test_the_repositorys_own_workflows_pass(monkeypatch):
    monkeypatch.chdir(Path(__file__).resolve().parents[2])
    assert check.main() == 0
