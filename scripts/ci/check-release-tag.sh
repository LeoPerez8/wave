#!/usr/bin/env bash
# Checks that a release tag names the app's version, so a wrong tag fails before the APK
# is built. The version is read from the app config the way prebuild reads it.
#   scripts/ci/check-release-tag.sh <tag>
set -euo pipefail

tag="$1"
cd "$(dirname "$0")/../../apps/mobile"
version="$(pnpm exec expo config --type public --json | jq -r .version)"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-release-tag.ts "$tag" "$version"
