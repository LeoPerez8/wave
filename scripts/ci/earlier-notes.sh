#!/usr/bin/env bash
# Prints, as one line of JSON, the notes in each language of the versions a release cut from
# <ref> (default HEAD) goes out after that the phone never published: tags whose GitHub Release
# holds no APK, or that have none, as skipped-releases.ts picks them. Each is
# { version, date, notes }, oldest first: its notes as its own run built them (patch-notes.sh
# from that tag), dated by its tag's commit. Prints [] when there are none. publish-notes.ts
# publishes the ones the update service lacks; a version the desktop released alone lists no
# phone PR, so it publishes nothing for it.
# Needs the whole history and its tags (actions/checkout with fetch-depth: 0).
#   scripts/ci/earlier-notes.sh [<ref>]
# Env: GH_TOKEN, GITHUB_REPOSITORY, IS_TI.
set -euo pipefail

here="$(dirname "$0")"
head="${1:-HEAD}"
repo="${GITHUB_REPOSITORY:?}"
channel=main
if [ "${IS_TI:-false}" = "true" ]; then channel=ti; fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

gh api "repos/$repo/releases?per_page=100" --paginate \
  --jq '.[] | select(.draft | not) | {tagName: .tag_name, assets: [.assets[].name]} | @json' \
  > "$tmp/published.txt"
mapfile -t own < <(git tag --points-at "$head" --list 'v*')
mapfile -t skipped < <(git tag --merged "$head" --list 'v*' |
  node "$here/skipped-releases.ts" "$channel" "$tmp/published.txt" ${own[@]+"${own[@]}"})

entries=()
for tag in ${skipped[@]+"${skipped[@]}"}; do
  since="$("$here/previous-tag.sh" "$tag" "$channel")"
  [ -n "$since" ] || continue
  notes="$tmp/${tag}.json"
  # The phone's notes alone: the desktop's are the release's own.
  PATCH_NOTES_SINCE="$since" LOCALIZED_NOTES_FILE="$notes" DESKTOP_NOTES_FILE= \
    DESKTOP_RELEASE_NOTES_FILE= "$here/patch-notes.sh" "$tag" > /dev/null
  [ -s "$notes" ] || continue
  entries+=("${tag#v}" "$(git log -1 --format=%cI "$tag")" "$notes")
  echo "Notes of ${tag#v}, which never published, from $since." >&2
done
node "$here/skipped-releases.ts" --entries ${entries[@]+"${entries[@]}"}
