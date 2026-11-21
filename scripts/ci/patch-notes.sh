#!/usr/bin/env bash
# Prints the patch notes of a release cut from <ref> (default HEAD): the PRs merged since
# its channel's previous version tag (previous-tag.sh; ti's with IS_TI=true), as
# patch-notes.ts sorts them into New and Fixes. With no previous version tag (0.5.0, the
# first), they're the hand-written docs/first-release-notes.md. Prints nothing when no PR
# is worth listing.
# Needs the whole history and its tags (actions/checkout with fetch-depth: 0).
#   scripts/ci/patch-notes.sh [<ref>]
# Env: GH_TOKEN, GITHUB_REPOSITORY, PATCH_NOTES_SINCE (optional: count from this ref
# instead of the previous version's tag), LOCALIZED_NOTES_FILE (optional: also write the
# release's notes in each language there, as localized-notes.ts prints them),
# DESKTOP_NOTES_FILE and DESKTOP_RELEASE_NOTES_FILE (optional: the desktop's notes there, in each
# language as JSON and in Markdown for its GitHub Release), DESKTOP_NOTES_SINCE (optional: the
# desktop's own previous release, which its notes count from instead, or `none` when it never
# released on the channel: its notes are then the hand-written docs/desktop-first-release-notes.md).
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

if [ -n "${LOCALIZED_NOTES_FILE:-}" ]; then
  node "$here/localized-notes.ts" "$tmp/commits.txt" "$tmp/bugs.txt" < "$tmp/prs.jsonl" \
    > "$LOCALIZED_NOTES_FILE" ||
    echo "::warning::Couldn't build the notes in each language; the release goes without them." >&2
fi

if [ "${DESKTOP_NOTES_SINCE:-}" = none ]; then
  # The desktop's first release on the channel: hand-written notes, as the phone's first has, and
  # none in each language.
  echo "The desktop never released on this channel, so its notes are its first release's." >&2
  if [ -n "${DESKTOP_NOTES_FILE:-}" ]; then : > "$DESKTOP_NOTES_FILE"; fi
  if [ -n "${DESKTOP_RELEASE_NOTES_FILE:-}" ]; then
    cp "$here/../../docs/desktop-first-release-notes.md" "$DESKTOP_RELEASE_NOTES_FILE"
  fi
elif [ -n "${DESKTOP_NOTES_FILE:-}" ] || [ -n "${DESKTOP_RELEASE_NOTES_FILE:-}" ]; then
  # The desktop's notes count from its own previous release when it has one: a version only the
  # phone released, or whose desktop never published, is no desktop release. Unknown (no list of
  # releases), they count from the channel's previous tag.
  desktop_since="${DESKTOP_NOTES_SINCE:-$since}"
  if ! [[ "$desktop_since" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-ti)?$ ]] \
    || ! git rev-parse -q --verify "refs/tags/$desktop_since^{commit}" > /dev/null; then
    desktop_since="$since"
  fi
  if [ "$desktop_since" = "$since" ]; then
    cp "$tmp/commits.txt" "$tmp/desktop-commits.txt"
    cp "$tmp/prs.jsonl" "$tmp/desktop-prs.jsonl"
  else
    echo "The desktop's notes count from its previous release, $desktop_since." >&2
    git rev-list "$desktop_since..$head" > "$tmp/desktop-commits.txt"
    "$here/merged-prs.sh" "$desktop_since" "$head" > "$tmp/desktop-prs.jsonl"
  fi
  if [ -n "${DESKTOP_NOTES_FILE:-}" ]; then
    node "$here/localized-notes.ts" "$tmp/desktop-commits.txt" "$tmp/bugs.txt" desktop \
      < "$tmp/desktop-prs.jsonl" > "$DESKTOP_NOTES_FILE"
  fi
  if [ -n "${DESKTOP_RELEASE_NOTES_FILE:-}" ]; then
    node "$here/patch-notes.ts" "$tmp/desktop-commits.txt" "$tmp/bugs.txt" desktop \
      < "$tmp/desktop-prs.jsonl" > "$DESKTOP_RELEASE_NOTES_FILE"
  fi
fi

node "$here/patch-notes.ts" "$tmp/commits.txt" "$tmp/bugs.txt" < "$tmp/prs.jsonl"
