#!/usr/bin/env bash
# Checks a published desktop release before a promotion or a rollback trusts it, as
# verified-release.sh does for the phone, with no need for an APK: the desktop's record
# (wave-<version>.desktop.provenance.json, or the phone's record for a release from before #1336)
# is the tag's, admitted installers and names the tag's commit as its source, and the installers
# on the GitHub Release are the ones it admitted (release-gate.ts verify-desktop-release,
# desktop-release.ts verify-published; docs/release-provenance.md). A stable release whose desktop
# was promoted from an older ti release than the phone's names that release in `promotedFrom`,
# and its commit must be the record's source. Writes `file=<record>` to $GITHUB_OUTPUT.
#   scripts/ci/verified-desktop-release.sh <tag> <dir>
# <dir> receives the record and the installers. Env: GH_TOKEN, GITHUB_REPOSITORY. Needs node and
# apps/updates.
set -euo pipefail

tag="$1"
dir="$2"
version="${tag#v}"
here="$(cd "$(dirname "$0")" && pwd)"
updates="$here/../../apps/updates/scripts/desktop-release.ts"
mkdir -p "$dir"

commit() { gh api "repos/${GITHUB_REPOSITORY:?}/commits/$1" --jq .sha; }

tagged="$(commit "$tag")"
if ! assets="$(gh release view "$tag" --json assets --jq '.assets[].name')"; then
  echo "::error::Couldn't list $tag's release assets, so its desktop record can't be checked."
  exit 1
fi
has() { printf '%s\n' "$assets" | grep -qxF "$1"; }

name="wave-$version.desktop.provenance.json"
# Before #1336 the desktop's admission was part of the phone's record.
if ! has "$name"; then name="wave-$version.provenance.json"; fi
if ! has "$name"; then
  echo "::error::$tag has no desktop record, so its installers can't be trusted."
  exit 1
fi
patterns=(--pattern "$name")
while IFS= read -r file; do
  if ! has "$file"; then
    echo "::error::$tag has no $file, so it holds no desktop release to trust."
    exit 1
  fi
  patterns+=(--pattern "$file")
done < <(node "$updates" names "$tag")
record="$dir/$name"
if ! gh release download "$tag" --dir "$dir" --clobber "${patterns[@]}" > /dev/null \
  || [ ! -f "$record" ]; then
  echo "::error::$tag's desktop record or installers couldn't be downloaded, so they can't be checked."
  exit 1
fi

promoted="$(node -p 'const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); String(r?.promotedFrom?.releaseTag ?? "")' "$record")"
promoted_commit=()
if [ -n "$promoted" ]; then
  if ! [[ "$promoted" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-ti$ ]]; then
    echo "::error::$tag's desktop record links \"$promoted\", which isn't a -ti release."
    exit 1
  fi
  promoted_commit=("$(commit "$promoted")")
fi

node "$here/release-gate.ts" verify-desktop-release "$record" "$tag" "$tagged" ${promoted_commit[@]+"${promoted_commit[@]}"}
node "$updates" verify-published "$record" "$dir"
echo "file=$record" >> "${GITHUB_OUTPUT:-/dev/null}"
