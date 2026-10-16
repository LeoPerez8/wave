#!/usr/bin/env bash
# Checks that a release tag names the app's version and sits on main, so a wrong tag fails
# before the APK is built. The version is read from the app config the way prebuild reads it.
# Run from the tag's checkout (HEAD is the tagged commit).
#   scripts/ci/check-release-tag.sh <tag>
set -euo pipefail

tag="$1"
cd "$(dirname "$0")/../../apps/mobile"
version="$(pnpm exec expo config --type public --json | jq -r .version)"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-release-tag.ts "$tag" "$version"

# A release ships what main has: the version bump's merge commit or a later main commit.
# In a shallow checkout this fetch stops at HEAD when HEAD is on main.
git fetch --quiet --no-tags origin main
if ! git merge-base --is-ancestor HEAD FETCH_HEAD; then
  echo "$tag is on $(git rev-parse --short HEAD), which isn't on main. Tag the version bump's merge commit on main." >&2
  exit 1
fi
