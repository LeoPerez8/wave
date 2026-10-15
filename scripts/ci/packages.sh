#!/usr/bin/env bash
# Runs a package script (typecheck, test) in the packages affected-packages.sh picked:
#   PACKAGES_FILTER="<its filter>" scripts/ci/packages.sh <script>
# With no filter it runs the root script, which covers every package and the root's own tests.
set -euo pipefail

if [ -z "${PACKAGES_FILTER:-}" ]; then
  exec pnpm run "$1"
fi

# Markdown is in no area of the change rule, so it doesn't make a package changed either.
# A filter that selects nothing (say, a docs-only PR) runs nothing and passes.
exec pnpm --filter "$PACKAGES_FILTER" --changed-files-ignore-pattern "**/*.md" run "$1"
