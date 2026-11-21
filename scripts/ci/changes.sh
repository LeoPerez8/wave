#!/usr/bin/env bash
# Writes what this run's change touches to $GITHUB_OUTPUT (see changes.ts for the
# areas and the rule). On a PR that's the PR's files, old names of moved files
# included. On anything else (main, release tags) every area counts as changed, so every check
# runs; whether each app releases (phoneRelease, desktopRelease) is whether the files changed
# since that app's own previous release reach it. Its previous release is the newest GitHub
# Release of the run's channel that holds its files (changes.ts --previous-release), and a
# change of the phone's package.json version alone doesn't count. The desktop's previous release
# is also written as desktopSince, which its patch notes count from.
# Env: GH_TOKEN, PR_NUMBER (empty outside PRs), GITHUB_REPOSITORY, GITHUB_REF. Off a PR, runs in
# a checkout of the run's commit with its history and tags.
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
  exit 0
fi

node "$here/changes.ts" --all | grep -vE '^(phoneRelease|desktopRelease)=' | tee -a "$out"

ref="${GITHUB_REF:-}"
channel=main
if [ "$ref" = refs/heads/main ] || [[ "$ref" == refs/tags/v*-ti ]]; then channel=ti; fi
current=""
if [[ "$ref" == refs/tags/* ]]; then current="${ref#refs/tags/}"; fi

# Without the list of releases, both apps count as changed: a release too many beats one missed.
if ! releases="$(gh api "repos/${GITHUB_REPOSITORY:?}/releases?per_page=100" --paginate \
  --jq '.[] | select(.draft | not) | {tagName: .tag_name, assets: [.assets[].name]} | @json')"; then
  echo "::warning::GitHub didn't list the releases, so both apps count as changed."
  printf 'phoneRelease=true\ndesktopRelease=true\n' | tee -a "$out"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
package=apps/mobile/package.json

for app in phone desktop; do
  since="$(printf '%s\n' "$releases" | node "$here/changes.ts" --previous-release "$app" "$channel" "$current")"
  # The desktop's notes count from its own previous release (the Patch notes job).
  if [ "$app" = desktop ]; then echo "desktopSince=$since" | tee -a "$out"; fi
  bump=()
  if [ -n "$since" ] && git rev-parse -q --verify "refs/tags/$since^{commit}" > /dev/null; then
    files="$(git diff --name-only "refs/tags/$since" HEAD)"
    # A version bump of the phone's package.json alone (a version the desktop released alone
    # made one) doesn't count.
    git show "refs/tags/$since:$package" > "$tmp/before.json" 2> /dev/null || : > "$tmp/before.json"
    git show "HEAD:$package" > "$tmp/after.json" 2> /dev/null || : > "$tmp/after.json"
    bump=(--app-package "$tmp/before.json" "$tmp/after.json")
    echo "::group::Changed since the $app's previous release, $since"
  else
    # It never published, or its tag is gone: everything counts as changed.
    files="$(git ls-tree -r --name-only HEAD)"
    echo "::group::No previous $app release on $channel${since:+ ($since has no tag)}: every file counts"
  fi
  echo "$files"
  echo "::endgroup::"
  printf '%s\n' "$files" | node "$here/changes.ts" ${bump[@]+"${bump[@]}"} \
    | grep -E "^${app}Release=" | tee -a "$out"
done
