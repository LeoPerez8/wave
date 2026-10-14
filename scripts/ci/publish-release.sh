#!/usr/bin/env bash
# Publishes a release build as the GitHub Release of its tag: "Wave <version>", not a
# prerelease, marked as the repo's latest release, with wave-<version>.apk attached.
# check-release-tag.sh has already made sure the tag is v<app version>.
#   scripts/ci/publish-release.sh <apk path>
# Env: GH_TOKEN, GITHUB_REF_NAME (the tag), RELEASE_NOTES_FILE (optional: the patch notes).
set -euo pipefail

apk="$1"
tag="${GITHUB_REF_NAME:?}"
version="${tag#v}"
dir="${RUNNER_TEMP:-/tmp}"
asset="$dir/wave-$version.apk"
cp "$apk" "$asset"

notes="${RELEASE_NOTES_FILE:-}"
if [ -z "$notes" ]; then
  notes="$dir/release-notes.md"
  echo "Wave $version for Android. Open wave-$version.apk on the phone to install it." > "$notes"
fi

# A re-run of the same tag replaces the APK and leaves the release as it was.
if gh release view "$tag" > /dev/null 2>&1; then
  gh release upload "$tag" "$asset" --clobber
else
  gh release create "$tag" "$asset" --verify-tag --latest \
    --title "Wave $version" --notes-file "$notes"
fi
echo "url=${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:?}/releases/download/${tag}/wave-${version}.apk" >> "${GITHUB_OUTPUT:-/dev/null}"
