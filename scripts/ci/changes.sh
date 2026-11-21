#!/usr/bin/env bash
# Writes what this run's change touches to $GITHUB_OUTPUT (see changes.ts for the
# areas and the rule). On a PR that's the PR's files, old names of moved files
# included; on pushes and tags, the paths since the channel's previous release are checked.
# Env: GH_TOKEN, PR_NUMBER (empty outside PRs), GITHUB_REPOSITORY, GITHUB_SHA and GITHUB_REF.
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
here="$(dirname "$0")"

if [ -n "${PR_NUMBER:-}" ]; then
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
else
  channel=main
  if [[ "${GITHUB_REF:-}" == refs/heads/main || "${GITHUB_REF_NAME:-}" == *-ti ]]; then channel=ti; fi
  since="$(git tag --merged "${GITHUB_SHA:?}" --list 'v*' | node "$here/previous-tag.ts" "$channel" "${GITHUB_REF_NAME:-}")"
  if [ -n "$since" ]; then
    files="$(git diff --name-only "$since" "${GITHUB_SHA}" )"
  else
    files="$(git ls-tree -r --name-only "${GITHUB_SHA}")"
  fi
  echo "::group::Changed since the previous $channel release"
  echo "$files"
  echo "::endgroup::"
  echo "$files" | node "$here/changes.ts" | tee -a "$out"
fi
