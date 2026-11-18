#!/usr/bin/env bash
# Checks a published release before a promotion or a rollback trusts it: its GitHub Release's
# sealed provenance record names the tag, the tag's commit as its source and the release's APK as
# the one it signed (release-gate.ts verify-release; docs/release-provenance.md). Writes
# `file=<record>` to $GITHUB_OUTPUT when it holds.
#   scripts/ci/verified-release.sh <tag> <dir> [--allow-unrecorded]
# <dir> receives the record and the APK. A release published before records has none, and fails,
# unless --allow-unrecorded (the owner's transition for rollbacks) lets it through with `file=`.
# A release that has a record is always checked. When GitHub can't list the release's assets, or
# can't give the record it lists, it fails whatever the flag. Env: GH_TOKEN, GITHUB_REPOSITORY.
set -euo pipefail

tag="$1"
dir="$2"
allow="${3:-}"
version="${tag#v}"
here="$(cd "$(dirname "$0")" && pwd)"
record="$dir/wave-$version.provenance.json"
apk="$dir/wave-$version.apk"
mkdir -p "$dir"

commit="$(gh api "repos/${GITHUB_REPOSITORY:?}/commits/$tag" --jq .sha)"
if ! assets="$(gh release view "$tag" --json assets --jq '.assets[].name')"; then
  echo "::error::Couldn't list $tag's release assets, so its provenance can't be checked."
  exit 1
fi
has() { printf '%s\n' "$assets" | grep -qxF "$1"; }

if ! has "wave-$version.provenance.json"; then
  if [ "$allow" = "--allow-unrecorded" ]; then
    echo "::warning::$tag has no provenance record. It goes on through the owner's transition for releases published before records."
    echo "file=" >> "${GITHUB_OUTPUT:-/dev/null}"
    exit 0
  fi
  echo "::error::$tag has no provenance record, so it can't be trusted as a verified release."
  exit 1
fi
if ! has "wave-$version.apk"; then
  echo "::error::$tag has a provenance record but no wave-$version.apk to check against it."
  exit 1
fi
if ! gh release download "$tag" --dir "$dir" --clobber \
  --pattern "wave-$version.provenance.json" --pattern "wave-$version.apk" > /dev/null \
  || [ ! -f "$record" ] || [ ! -f "$apk" ]; then
  echo "::error::$tag's provenance record or APK couldn't be downloaded, so it can't be checked."
  exit 1
fi

node "$here/release-gate.ts" verify-release "$record" "$tag" "$commit" "$apk"
echo "file=$record" >> "${GITHUB_OUTPUT:-/dev/null}"
