#!/usr/bin/env bash
# Checks that a release tag names the app's version and sits on main, so a wrong tag fails
# before the APK is built. The version lives in apps/mobile/package.json and is read through the
# app config the way prebuild reads it.
# Run from the tag's checkout (HEAD is the tagged commit).
#   scripts/ci/check-release-tag.sh <tag>
set -euo pipefail

tag="$1"
cd "$(dirname "$0")/../../apps/mobile"
version="$(pnpm exec expo config --type public --json | jq -r .version)"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-release-tag.ts "$tag" "$version"

# A stable tag over a -ti version is a promotion, which must be that release's own commit.
if [ "$tag" != "v$version" ]; then
  git fetch --quiet --no-tags origin "refs/tags/v$version:refs/tags/v$version"
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse "v$version^{commit}")" ]; then
    echo "$tag is on $(git rev-parse --short HEAD), which isn't the commit of v$version. Promote it with the Promote to main workflow." >&2
    exit 1
  fi
fi

# Every release ships main.
git fetch --quiet --no-tags origin main
if ! git merge-base --is-ancestor HEAD FETCH_HEAD; then
  echo "$tag is on $(git rev-parse --short HEAD), which isn't on main. Tag the version bump's commit on main." >&2
  exit 1
fi
