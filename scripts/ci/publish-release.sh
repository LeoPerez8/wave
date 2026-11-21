#!/usr/bin/env bash
# Publishes one app's files to the GitHub Release "Wave <version>". Versions ending in -ti are
# prereleases; stable versions become Latest. The phone and the desktop publish on their own
# (mobile.yml, desktop.yml): whichever gets there first creates the release, and the other adds
# its files to it. Each writes its own notes into the release's body, the phone's first
# (release-notes.ts), so the notes are the same whichever app gets there first.
# The tag already exists: the Version job pushed it with the version bump on main
# (bump-version.sh), or a promotion pushed it (promote.sh), and either that or a hand-pushed
# one passed check-release-tag.sh in Checks.
#   scripts/ci/publish-release.sh <apk path>                 the phone, as wave-<version>.apk
#   RELEASE_APP=desktop scripts/ci/publish-release.sh <installer>...   the desktop's files
# Run from a checkout of the repo. Env: GH_TOKEN, RELEASE_APP (android, the default, or
# desktop), RELEASE_TAG (default GITHUB_REF_NAME), GITHUB_REF_TYPE, RELEASE_SHA (the commit a
# branch push releases: its version bump; default GITHUB_SHA), RELEASE_NOTES_FILE (optional: the
# patch notes), PROVENANCE_FILE (optional: the app's gate record, attached as
# wave-<version>.provenance.json for the phone and wave-<version>.desktop.provenance.json for the
# desktop; docs/release-provenance.md), SOURCE_MANIFEST_FILE and SOURCE_DIRECTIONS_FILE (optional:
# where the release's source is, attached as wave-<version>.source.json and .source.md, the
# directions also added to the notes; docs/release-source.md).
set -euo pipefail

here="$(dirname "$0")"
app="${RELEASE_APP:-android}"
tag="${RELEASE_TAG:-${GITHUB_REF_NAME:?}}"
version="${tag#v}"
dir="${RUNNER_TEMP:-/tmp}"
case "$app" in
  android)
    apk="$1"
    shift
    asset="$dir/wave-$version.apk"
    cp "$apk" "$asset"
    assets=("$asset" "$@")
    record_name="wave-$version.provenance.json"
    # The file that shows the app was published here, with or without a record.
    own="wave-$version.apk"
    ;;
  desktop)
    if [ $# -eq 0 ]; then
      echo "::error::No desktop installers to publish."
      exit 1
    fi
    assets=("$@")
    record_name="wave-$version.desktop.provenance.json"
    own="$(basename "$1")"
    ;;
  *)
    echo "::error::RELEASE_APP is android or desktop, not \"$app\"."
    exit 1
    ;;
esac
if [ -n "${PROVENANCE_FILE:-}" ]; then
  cp "$PROVENANCE_FILE" "$dir/$record_name"
  assets+=("$dir/$record_name")
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
elif [ "$app" = android ]; then
  echo "Wave $version for Android. Open wave-$version.apk on the phone to install it." > "$notes"
else
  echo "Wave $version for desktop." > "$notes"
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

# Adds this app's files to the existing release. A re-run of the same tag replaces them only when
# the app's record there names this run's source (docs/release-provenance.md). A release whose
# record has another source, or whose files are from before records, keeps what it has; so does
# any release GitHub can't list or whose record can't be downloaded. The other app's files and
# record count for nothing. Then it writes this app's notes beside the other app's.
add_to_release() {
  if ! held="$(gh release view "$tag" --json assets --jq '.assets[].name')"; then
    echo "::error::GitHub didn't say what $tag holds, so nothing was replaced."
    exit 1
  fi
  has() { grep -qxF "$1" <<< "$held"; }
  if has "$record_name"; then
    published="$dir/published-provenance"
    if ! gh release download "$tag" --pattern "$record_name" --dir "$published" \
      --clobber > /dev/null; then
      echo "::error::$tag's provenance record couldn't be downloaded, so nothing was replaced."
      exit 1
    fi
    recorded="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).source ?? ""' \
      "$published/$record_name" 2> /dev/null || true)"
    if [ "$recorded" != "${RELEASE_SHA:-${GITHUB_SHA:?}}" ]; then
      echo "::error::$tag was published from ${recorded:0:7}, not from this run's ${RELEASE_SHA:-$GITHUB_SHA}. Its files and record stay as they are."
      exit 1
    fi
  elif has "$own"; then
    echo "::error::$tag's $own was published before provenance records, so nothing shows it came from this run's source. It stays as it is."
    exit 1
  fi
  gh release upload "$tag" "${assets[@]}" --clobber
  write_notes
}

# Both release jobs can write the body at once, and the later write wins. So after each write
# this reads the body back, after a pause, and writes again while it lacks this app's notes.
write_notes() {
  local body="$dir/release-body.md" merged="$dir/release-body.merged.md" attempt=0
  local edit=()
  if [ "$app" = android ] && [[ "$version" == *-ti ]]; then edit=(--prerelease --latest=false); fi
  while :; do
    if ! gh release view "$tag" --json body --jq .body > "$body"; then
      echo "::error::GitHub didn't give $tag's notes, so they weren't written."
      exit 1
    fi
    if [ "$attempt" -gt 0 ] && node "$here/release-notes.ts" "$app" "$notes" --unchanged < "$body"; then
      return 0
    fi
    if [ "$attempt" -eq 3 ]; then
      echo "::warning::$tag's notes kept changing, so they may lack the $app notes."
      return 0
    fi
    node "$here/release-notes.ts" "$app" "$notes" < "$body" > "$merged"
    gh release edit "$tag" --notes-file "$merged" "${edit[@]}"
    attempt=$((attempt + 1))
    sleep "${RELEASE_NOTES_SETTLE:-5}"
  done
}

create_release() {
  node "$here/release-notes.ts" "$app" "$notes" < /dev/null > "$dir/release-body.md"
  if [ ${#target[@]} -gt 0 ]; then
    gh release create "$tag" "${assets[@]}" "${target[@]}" "${flags[@]}" \
      --title "Wave $version" --notes-file "$dir/release-body.md"
  else
    gh release create "$tag" "${assets[@]}" --verify-tag "${flags[@]}" \
      --title "Wave $version" --notes-file "$dir/release-body.md"
  fi
}

if gh release view "$tag" > /dev/null 2>&1; then
  add_to_release
elif ! create_release; then
  # The other app's release job may have created it since.
  if ! gh release view "$tag" > /dev/null 2>&1; then
    echo "::error::$tag couldn't be created."
    exit 1
  fi
  add_to_release
fi
echo "Published $tag for $app: ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:?}/releases/tag/$tag"
if [ "$app" = android ]; then
  echo "url=${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:?}/releases/download/${tag}/wave-${version}.apk" >> "${GITHUB_OUTPUT:-/dev/null}"
else
  echo "url=${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:?}/releases/tag/${tag}" >> "${GITHUB_OUTPUT:-/dev/null}"
fi
