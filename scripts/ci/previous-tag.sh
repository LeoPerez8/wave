#!/usr/bin/env bash
# Prints a channel's previous release before <ref>, the tag its changes, patch notes and
# version bump count from (previous-tag.ts decides), or nothing when it has none.
# Needs <ref>'s history and the repo's tags.
#   scripts/ci/previous-tag.sh <ref> main|ti
set -euo pipefail

here="$(dirname "$0")"
ref="${1:?}"
channel="${2:?}"

mapfile -t own < <(git tag --points-at "$ref" --list 'v*')
git tag --merged "$ref" --list 'v*' | node "$here/previous-tag.ts" "$channel" ${own[@]+"${own[@]}"}
