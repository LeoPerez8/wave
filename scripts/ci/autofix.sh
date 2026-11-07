#!/usr/bin/env bash
# PR-only, the half of the autofix that runs the PR's code: brings the lockfile up to date and
# applies formatting, then writes the result as a patch. Its job has a read-only token; the
# Apply autofix job (scripts/ci/apply-autofix.sh) commits the patch only if it holds nothing but
# a lockfile update and formatting. Agent sessions working on this repo can't reach the npm
# registry, so CI is where the lockfile gets resolved.
#   scripts/ci/autofix.sh <patch file>
# Writes `patch=true` to $GITHUB_OUTPUT when there's something to commit.
set -euo pipefail

patch="${1:?Usage: scripts/ci/autofix.sh <patch file>}"

pnpm install --no-frozen-lockfile
pnpm fmt

mkdir -p "$(dirname "$patch")"
git add -A
git diff --cached --binary HEAD > "$patch"
if [ -s "$patch" ]; then
  echo "Lockfile/formatting changes for the Apply autofix job:"
  git diff --cached --stat HEAD
  echo "patch=true" >> "${GITHUB_OUTPUT:-/dev/null}"
fi
