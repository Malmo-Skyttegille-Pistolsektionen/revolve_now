#!/usr/bin/env bash
# Checks the two places a breaking marker survives a squash merge: the PR
# title (PR_TITLE, the squashed subject) and the branch commit messages on
# stdin (`git log --format=%B base..head`, the squashed body). AGENTS.md,
# "the commit" is two pieces of text.
#
#   consistent  fail if a commit carries a breaking footer the title lacks `!` for
#   marked      fail unless the title has `!` or a commit carries the footer
set -uo pipefail

mode="${1:?usage: check_breaking_marker.sh consistent|marked < commit-messages}"

title_bang=false
if grep -qE '^[a-zA-Z]+(\([^)]*\))?!:' <<<"${PR_TITLE:?PR_TITLE is not set}"; then
  title_bang=true
fi

# A footer begins a line; matching anywhere would accept prose that merely
# mentions it. Conventional Commits makes BREAKING-CHANGE a synonym. stdin is
# read whole first: `grep -q` stopping early would SIGPIPE the writing
# `git log`, which `pipefail` in the caller turns into a failure.
footer=false
messages="$(cat)"
if grep -qE '^BREAKING[ -]CHANGE:' <<<"$messages"; then
  footer=true
fi

case "$mode" in
  consistent)
    if [ "$footer" = true ] && [ "$title_bang" = false ]; then
      echo "::error::A commit on this branch carries a 'BREAKING CHANGE:' footer, which reaches"
      echo "::error::main in the squashed body and marks the release breaking, but the PR title"
      echo "::error::does not say so. Add '!' after the title's type (e.g. 'feat!:'), or reword"
      echo "::error::the footer if the change is not breaking. See AGENTS.md."
      exit 1
    fi
    echo "Title and commit bodies agree (title '!': $title_bang, breaking footer: $footer)."
    ;;
  marked)
    if [ "$title_bang" = true ] || [ "$footer" = true ]; then
      echo "Marked breaking (title '!': $title_bang, breaking footer: $footer)."
      exit 0
    fi
    echo "::error::The contract diff above is breaking, but nothing that survives the squash"
    echo "::error::says so. Either mark the PR title with '!' after the type (e.g. 'feat!:'),"
    echo "::error::which becomes the squashed commit's subject, or add a 'BREAKING CHANGE:'"
    echo "::error::footer to a commit on this branch. A footer in the PR body does not count:"
    echo "::error::the squash takes its body from the commit messages, not from the PR."
    echo "::error::Without one, git-cliff ships this under a minor bump."
    echo "::error::See AGENTS.md, 'How the contracts are versioned'."
    exit 1
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
