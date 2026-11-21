#!/usr/bin/env bash
# Prints, as one line of JSON, the notes in each language of the versions a release cut from
# <ref> (default HEAD) goes out after that never published: tags with no GitHub release, as
# skipped-releases.ts picks them. Each is { version, date, notes }, oldest first: its notes as
# its own run built them (patch-notes.sh from that tag), dated by its tag's commit. Prints [] when
# there are none. publish-notes.ts publishes the ones the update service lacks.
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

gh release list --repo "$repo" --limit 1000 --json tagName --jq '.[].tagName' > "$tmp/published.txt"
mapfile -t own < <(git tag --points-at "$head" --list 'v*')
mapfile -t skipped < <(git tag --merged "$head" --list 'v*' |
  node "$here/skipped-releases.ts" "$channel" "$tmp/published.txt" ${own[@]+"${own[@]}"})

entries=()
for tag in ${skipped[@]+"${skipped[@]}"}; do
  since="$("$here/previous-tag.sh" "$tag" "$channel")"
  [ -n "$since" ] || continue
  notes="$tmp/${tag}.json"
  PATCH_NOTES_SINCE="$since" LOCALIZED_NOTES_FILE="$notes" \
    "$here/patch-notes.sh" "$tag" > /dev/null
  [ -s "$notes" ] || continue
  entries+=("${tag#v}" "$(git log -1 --format=%cI "$tag")" "$notes")
  echo "Notes of ${tag#v}, which never published, from $since." >&2
done
node "$here/skipped-releases.ts" --entries ${entries[@]+"${entries[@]}"}
