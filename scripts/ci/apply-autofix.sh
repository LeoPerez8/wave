#!/usr/bin/env bash
# PR-only, the half of the autofix that can push: commits the Autofix job's patch to the PR
# branch when it holds only a lockfile update and formatting (scripts/ci/autofix-patch.ts), and
# commits nothing otherwise. Run from a checkout of the PR's base branch with its dependencies
# installed; it never runs the PR's code, and the formatter it checks with is the base's.
#   scripts/ci/apply-autofix.sh <patch> <PR checkout>
# Env: HEAD_REF (the PR's branch). Writes `sha=<commit>` to $GITHUB_OUTPUT when it commits, and
# the Autofix comment for the Report job to $RUNNER_TEMP/ci-report.
set -euo pipefail

patch="${1:?}"
pr="${2:?}"
here="$(dirname "$0")"
report="${RUNNER_TEMP:-/tmp}/ci-report"
mkdir -p "$report"
marker="<!-- wave-ci:Autofix -->"

set +e
verdict="$(node "$here/autofix-patch.ts" "$patch" "$pr")"
status=$?
set -e

if [ "$status" = 2 ]; then
  echo "::warning::Autofix not applied: $verdict"
  {
    echo "$marker"
    echo "### ⚠️ Autofix not applied"
    echo
    echo "CI commits only a lockfile update and formatting, and this PR's install and format run"
    echo "changed more, so nothing was committed:"
    echo
    echo '```text'
    echo "$verdict" | cut -c1-400 | head -n 40
    echo '```'
  } > "$report/autofix.md"
  exit 0
fi
if [ "$status" != 0 ]; then
  echo "$verdict"
  exit "$status"
fi

# A marker alone clears an earlier "not applied" comment.
echo "$marker" > "$report/autofix.md"
[ -n "$verdict" ] || exit 0

git -C "$pr" -c user.name="github-actions[bot]" \
  -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -q -m "chore: update lockfile and formatting"
git -C "$pr" push -q origin "HEAD:refs/heads/${HEAD_REF:?}"
echo "Committed lockfile/formatting changes:"
git -C "$pr" show --stat --oneline HEAD
echo "sha=$(git -C "$pr" rev-parse HEAD)" >> "${GITHUB_OUTPUT:-/dev/null}"
