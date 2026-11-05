#!/usr/bin/env bash
# The fast repo-wide checks, about 5 s. Tests near a change can't catch what these catch.
# Runs before each commit (.githooks/pre-commit) and in scripts/merge-ticket.sh. The slow
# guard, performanceGuards.test.ts (about 150 s), stays in the full suite.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
pnpm -s lint --quiet
cd apps/mobile
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test \
  src/hermes.test.ts src/perf/memoDependencies.test.ts src/untranslatedText.test.ts >/dev/null
