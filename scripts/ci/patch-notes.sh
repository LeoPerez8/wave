#!/usr/bin/env bash
# Prints the patch notes of a release cut from <ref> (default HEAD): the PRs merged since
# its channel's previous version tag (previous-tag.sh; ti's with IS_TI=true), as
# patch-notes.ts sorts them into New and Fixes. With no previous version tag (0.5.0, the
# first), they're the hand-written docs/first-release-notes.md. Prints nothing when no PR
# is worth listing.
# Needs the whole history and its tags (actions/checkout with fetch-depth: 0).
#   scripts/ci/patch-notes.sh [<ref>]
# Env: GH_TOKEN, GITHUB_REPOSITORY, PATCH_NOTES_SINCE (optional: count from this ref
# instead of the previous version's tag).
set -euo pipefail

here="$(dirname "$0")"
head="${1:-HEAD}"
repo="${GITHUB_REPOSITORY:?}"

since="${PATCH_NOTES_SINCE:-}"
if [ -z "$since" ]; then
  channel=main
  if [ "${IS_TI:-false}" = "true" ]; then channel=ti; fi
  since="$("$here/previous-tag.sh" "$head" "$channel")"
fi
if [ -z "$since" ]; then
  cat "$here/../../docs/first-release-notes.md"
  exit 0
fi

commits="$(git rev-list "$since..$head")"
[ -n "$commits" ] || exit 0

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "$commits" > "$tmp/commits.txt"
gh issue list --repo "$repo" --label bug --state all --limit 1000 --json number \
  --jq '.[].number' > "$tmp/bugs.txt"

"$here/merged-prs.sh" "$since" "$head" > "$tmp/prs.jsonl"

node "$here/patch-notes.ts" "$tmp/commits.txt" "$tmp/bugs.txt" < "$tmp/prs.jsonl"
