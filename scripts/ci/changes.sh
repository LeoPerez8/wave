#!/usr/bin/env bash
# Writes what this run's change touches to $GITHUB_OUTPUT (see changes.ts for the
# areas and the rule). On a PR that's the PR's files, old names of moved files
# included; on anything else, every area counts as changed.
# Env: GH_TOKEN, PR_NUMBER (empty outside PRs), GITHUB_REPOSITORY.
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
here="$(dirname "$0")"

if [ -z "${PR_NUMBER:-}" ]; then
  node "$here/changes.ts" --all | tee -a "$out"
  exit 0
fi

files="$(gh api "repos/${GITHUB_REPOSITORY:?}/pulls/${PR_NUMBER}/files" --paginate \
  --jq '.[] | .filename, (.previous_filename // empty)')"
echo "::group::Changed files"
echo "$files"
echo "::endgroup::"

# The API lists at most 3000 files; past that, don't trust the list.
if [ "$(echo "$files" | grep -c .)" -ge 3000 ]; then
  node "$here/changes.ts" --all | tee -a "$out"
else
  echo "$files" | node "$here/changes.ts" | tee -a "$out"
fi
