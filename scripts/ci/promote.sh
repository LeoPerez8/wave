#!/usr/bin/env bash
# Promotes a -ti release to the main channel (docs/spec.md, Promotion). Each app goes out from its
# own newest -ti release at or below that version, as promote-version.ts picks them: the phone's
# with an APK and a sealed record, the desktop's with installers, and the desktop only while
# RELEASE_DESKTOP_MAIN is on. It checks each one, tags the stable number on the phone's commit (the
# desktop's when the phone isn't promoted) and starts CI on that tag once per ti release the apps
# come from, naming the apps that run publishes and that release (ci.yml's workflow_dispatch
# inputs). Each run checks, builds in full and publishes through its app's gate and the main
# Environment. The token's tag push starts no run by itself, so nothing runs twice.
#   scripts/ci/promote.sh [<version> [both|mobile|desktop]]
# Run from a checkout of the repo with its tags. Env: GH_TOKEN, GITHUB_REPOSITORY,
# RELEASE_DESKTOP_MAIN (on lets the desktop go out). Needs node.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
app="${2:-both}"
desktop_main="${RELEASE_DESKTOP_MAIN:-off}"

git tag --list 'v*' > "$tmp/tags.txt"
if ! gh api "repos/${GITHUB_REPOSITORY:?}/releases?per_page=100" --paginate \
  --jq '.[] | select(.draft | not) | {tagName: .tag_name, assets: [.assets[].name]} | @json' \
  > "$tmp/releases.txt"; then
  echo "::error::GitHub didn't list the releases, so no app's release can be picked." >&2
  exit 1
fi
node "$here/promote-version.ts" "$tmp/tags.txt" "${1:-}" "$tmp/releases.txt" "$app" "$desktop_main" \
  > "$tmp/promotion.txt"
field() { sed -n "s/^$1=//p" "$tmp/promotion.txt"; }
from="$(field from)"
to="$(field to)"
mobile="$(field mobile)"
desktop="$(field desktop)"

git fetch --quiet --no-tags origin main
on_main() {
  local commit
  commit="$(git rev-parse "$1^{commit}")"
  if ! git merge-base --is-ancestor "$commit" FETCH_HEAD; then
    echo "::error::$1 is on ${commit:0:7}, which isn't on main." >&2
    exit 1
  fi
}

# Only ti releases that were tested: the phone's sealed record names its commit and its APK, the
# desktop's its commit and installers (docs/release-provenance.md). Each tag run's gate checks the
# record again before it admits.
if [ -n "$mobile" ]; then
  on_main "$mobile"
  if ! "$here/verified-release.sh" "$mobile" "$tmp/mobile"; then
    echo "::error::$mobile has no verified provenance record, so the phone can't be promoted from it. A ti release published before records can't be; promote a newer one." >&2
    exit 1
  fi
fi
if [ -n "$desktop" ]; then
  on_main "$desktop"
  # Its gate links the stable desktop to this ti release with the source's own gate script.
  if ! git show "$desktop^{commit}:scripts/ci/release-gate.ts" | grep -q 'promote-desktop'; then
    echo "::error::$desktop predates the desktop's promotion, so the desktop can't be promoted from it. Promote a newer version." >&2
    exit 1
  fi
  if ! "$here/verified-desktop-release.sh" "$desktop" "$tmp/desktop"; then
    echo "::error::$desktop's desktop record or installers don't check out, so the desktop can't be promoted from it." >&2
    exit 1
  fi
fi

# The stable tag goes on the phone's commit, so the phone's record names the tag's commit as any
# release's does; a desktop from another commit links its ti release in its own record.
tagged="${mobile:-$desktop}"
commit="$(git rev-parse "$tagged^{commit}")"

# One run per ti release the apps come from: "<app> <ti tag>".
runs=()
if [ -n "$mobile" ] && [ "$mobile" = "$desktop" ]; then
  runs=("both $mobile")
else
  if [ -n "$mobile" ]; then runs+=("mobile $mobile"); fi
  if [ -n "$desktop" ]; then runs+=("desktop $desktop"); fi
fi

# The run uses the workflow as the tag has it, so the tag must be able to start one.
workflow="$(git show "$commit:.github/workflows/ci.yml")"
if ! grep -q 'workflow_dispatch:' <<< "$workflow"; then
  echo "::error::$tagged predates promotions: its CI can't be started on a tag. Promote a newer version." >&2
  exit 1
fi
# A CI from before per-app promotion takes no inputs: it builds both apps from the tag's commit
# and admits only the same number's ti release. That is this promotion only when it is one.
per_app=true
if ! grep -q 'promoted_from:' <<< "$workflow"; then
  per_app=false
  if [ "${runs[*]}" != "both $from" ] \
    && { [ "${runs[*]}" != "mobile $from" ] || [ "$desktop_main" = on ]; }; then
    echo "::error::$tagged predates promoting each app on its own. Promote both apps from $from, or a newer version." >&2
    exit 1
  fi
fi

git tag "$to" "$commit"
git push --quiet origin "refs/tags/$to"
for run in "${runs[@]}"; do
  read -r apps source <<< "$run"
  inputs=()
  if $per_app; then inputs=(-f "app=$apps" -f "promoted_from=$source"); fi
  if ! gh workflow run ci.yml --repo "${GITHUB_REPOSITORY:?}" --ref "$to" ${inputs[@]+"${inputs[@]}"}; then
    echo "::error::$to is tagged but the CI run for $apps didn't start. Start it with: gh workflow run ci.yml --ref $to ${inputs[*]}" >&2
    exit 1
  fi
  built="$(git rev-parse --short "$source^{commit}")"
  echo "Promoting $apps from $source ($built) to $to. The CI run on $to publishes it." \
    | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
done
