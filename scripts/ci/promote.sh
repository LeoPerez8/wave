#!/usr/bin/env bash
# Promotes a -ti release to the main channel (docs/spec.md, Releases): tags its commit with the
# stable number and starts CI on that tag, which checks, builds in full and publishes it. The
# token's tag push starts no run by itself, so nothing runs twice. promote-version.ts picks and
# checks the version.
#   scripts/ci/promote.sh [<version>]
# Run from a checkout of the repo with its tags. Env: GH_TOKEN, GITHUB_REPOSITORY.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git tag --list 'v*' > "$tmp/tags.txt"
node "$here/promote-version.ts" "$tmp/tags.txt" "${1:-}" > "$tmp/promotion.txt"
from="$(sed -n 's/^from=//p' "$tmp/promotion.txt")"
to="$(sed -n 's/^to=//p' "$tmp/promotion.txt")"
commit="$(git rev-parse "$from^{commit}")"

git fetch --quiet --no-tags origin main
if ! git merge-base --is-ancestor "$commit" FETCH_HEAD; then
  echo "::error::$from is on ${commit:0:7}, which isn't on main." >&2
  exit 1
fi
# The run uses the workflow as the tag has it, so the tag must be able to start one.
if ! git show "$commit:.github/workflows/ci.yml" | grep -q 'workflow_dispatch:'; then
  echo "::error::$from predates promotions: its CI can't be started on a tag. Promote a newer version." >&2
  exit 1
fi

git tag "$to" "$commit"
git push --quiet origin "refs/tags/$to"
if ! gh workflow run ci.yml --repo "${GITHUB_REPOSITORY:?}" --ref "$to"; then
  echo "::error::$to is tagged but its CI run didn't start. Start it with: gh workflow run ci.yml --ref $to" >&2
  exit 1
fi
echo "Promoting $from to $to (${commit:0:7}). The CI run on $to publishes it." | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
