#!/usr/bin/env bash
# Picks the packages Checks typechecks and tests, by the rule in changes.ts, and writes
# `filter=<pnpm filter>` to $GITHUB_OUTPUT for packages.sh. An empty filter means every
# package: outside PRs (main, release tags) and on PRs whose change can affect them all.
# Otherwise the filter selects the packages the PR changed since it left its base branch,
# and the packages that depend on them.
# Env: BASE_REF (the PR's base branch; empty outside PRs).
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
here="$(dirname "$0")"

if [ -z "${BASE_REF:-}" ]; then
  echo "filter=" | tee -a "$out"
  exit 0
fi

# The checkout only has the PR's tip; finding where it left the base needs both histories.
unshallow=()
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then unshallow=(--unshallow); fi
git fetch --quiet --no-tags "${unshallow[@]}" origin "+refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF"
base="$(git merge-base "origin/$BASE_REF" HEAD)"

# Both names of a moved file, as in changes.sh.
files="$(git diff --name-only --no-renames "$base" HEAD)"
echo "::group::Changed files since $base"
echo "$files"
echo "::endgroup::"

if echo "$files" | node "$here/changes.ts" | grep -qx "allPackages=true"; then
  echo "filter=" | tee -a "$out"
else
  echo "filter=...[$base]" | tee -a "$out"
fi
