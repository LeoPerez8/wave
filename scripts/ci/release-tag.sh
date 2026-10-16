#!/usr/bin/env bash
# Decides which versioned release this push publishes, if any (release-tag.ts), from the
# app's version and the repo's tags, and writes `tag=<tag>` to $GITHUB_OUTPUT (empty for
# none). The version is read from the app config the way prebuild reads it.
#   scripts/ci/release-tag.sh
# Env: GITHUB_REF (the pushed ref), GITHUB_OUTPUT.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../../apps/mobile"
version="$(pnpm exec expo config --type public --json | jq -r .version)"
# The branch the version is released from (releaseBranch), as check-release-tag.ts reports it.
branch="$(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-release-tag.ts "v$version" "$version" --branch)"
tags="$(git ls-remote --tags --refs origin 'v*' | sed 's|.*refs/tags/||')"
printf '%s\n' "$tags" \
  | node "$here/release-tag.ts" "${GITHUB_REF:?}" "$version" "$branch" \
  | tee -a "${GITHUB_OUTPUT:-/dev/null}"
