#!/usr/bin/env bash
# Publishes "Wave <version>" with wave-<version>.apk. Versions ending in -ti are
# prereleases; stable versions become Latest.
# The tag already exists: the Version job pushed it with the version bump on main
# (bump-version.sh), or a promotion pushed it (promote.sh), and either that or a hand-pushed
# one passed check-release-tag.sh in Checks.
#   scripts/ci/publish-release.sh <apk path>
# Run from a checkout of the repo. Env: GH_TOKEN, RELEASE_TAG (default GITHUB_REF_NAME),
# GITHUB_REF_TYPE, RELEASE_SHA (the commit a branch push releases: its version bump; default
# GITHUB_SHA), RELEASE_NOTES_FILE (optional: the patch notes), PROVENANCE_FILE (optional: the
# release gate's sealed record, attached as wave-<version>.provenance.json; docs/release-provenance.md),
# SOURCE_MANIFEST_FILE and SOURCE_DIRECTIONS_FILE (optional: where the release's source is, attached
# as wave-<version>.source.json and .source.md, the directions also added to the notes;
# docs/release-source.md).
set -euo pipefail

apk="$1"
tag="${RELEASE_TAG:-${GITHUB_REF_NAME:?}}"
version="${tag#v}"
dir="${RUNNER_TEMP:-/tmp}"
asset="$dir/wave-$version.apk"
cp "$apk" "$asset"
assets=("$asset")
if [ -n "${PROVENANCE_FILE:-}" ]; then
  cp "$PROVENANCE_FILE" "$dir/wave-$version.provenance.json"
  assets+=("$dir/wave-$version.provenance.json")
fi

if [ -n "${SOURCE_MANIFEST_FILE:-}" ]; then
  cp "$SOURCE_MANIFEST_FILE" "$dir/wave-$version.source.json"
  assets+=("$dir/wave-$version.source.json")
fi
if [ -n "${SOURCE_DIRECTIONS_FILE:-}" ]; then
  cp "$SOURCE_DIRECTIONS_FILE" "$dir/wave-$version.source.md"
  assets+=("$dir/wave-$version.source.md")
fi

notes="$dir/release-notes.md"
if [ -n "${RELEASE_NOTES_FILE:-}" ]; then
  cp "$RELEASE_NOTES_FILE" "$notes.in"
  mv "$notes.in" "$notes"
else
  echo "Wave $version for Android. Open wave-$version.apk on the phone to install it." > "$notes"
fi
# The directions sit next to the APK on the release page (GPLv3 section 6(d)).
if [ -n "${SOURCE_DIRECTIONS_FILE:-}" ]; then
  printf '\n' >> "$notes"
  cat "$SOURCE_DIRECTIONS_FILE" >> "$notes"
fi

flags=(--latest)
if [[ "$version" == *-ti ]]; then flags=(--prerelease --latest=false); fi

# A branch push publishes the tag its version bump pushed, which sits on RELEASE_SHA. If the
# tag is on another commit (someone moved it), that release stays as it is and this run
# publishes nothing. A missing tag (one deleted since) is created on RELEASE_SHA.
target=()
if [ "${GITHUB_REF_TYPE:-tag}" = "branch" ]; then
  sha="${RELEASE_SHA:-${GITHUB_SHA:?}}"
  # The tag's commit (the peeled ^{} line when the tag is annotated), empty when untagged.
  tagged="$(git ls-remote origin "refs/tags/$tag" "refs/tags/$tag^{}" | sort -k2 | tail -n 1 | cut -f1)"
  if [ -n "$tagged" ] && [ "$tagged" != "$sha" ]; then
    echo "::warning::$tag already exists on ${tagged:0:7}, not on this run's ${sha:0:7}. Publishing nothing."
    exit 0
  fi
  if [ -z "$tagged" ]; then target=(--target "$sha"); fi
fi

# A re-run of the same tag replaces the APK and leaves the release as it was. A release whose
# record names another source keeps its APK and record (docs/release-provenance.md); one from
# before records has none to compare.
if gh release view "$tag" > /dev/null 2>&1; then
  published="$dir/published-provenance"
  if gh release download "$tag" --pattern "wave-$version.provenance.json" --dir "$published" \
    --clobber > /dev/null 2>&1; then
    recorded="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).source ?? ""' \
      "$published/wave-$version.provenance.json" 2> /dev/null || true)"
    if [ "$recorded" != "${RELEASE_SHA:-${GITHUB_SHA:?}}" ]; then
      echo "::error::$tag was published from ${recorded:0:7}, not from this run's ${RELEASE_SHA:-$GITHUB_SHA}. Its APK and record stay as they are."
      exit 1
    fi
  fi
  gh release upload "$tag" "${assets[@]}" --clobber
  if [[ "$version" == *-ti ]]; then gh release edit "$tag" --prerelease --latest=false; fi
elif [ ${#target[@]} -gt 0 ]; then
  gh release create "$tag" "${assets[@]}" "${target[@]}" "${flags[@]}" \
    --title "Wave $version" --notes-file "$notes"
else
  gh release create "$tag" "${assets[@]}" --verify-tag "${flags[@]}" \
    --title "Wave $version" --notes-file "$notes"
fi
echo "Published $tag: ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:?}/releases/tag/$tag"
echo "url=${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:?}/releases/download/${tag}/wave-${version}.apk" >> "${GITHUB_OUTPUT:-/dev/null}"
