#!/usr/bin/env bash
# Install apps and their workspace dependencies in this worktree.
#   scripts/install-for.sh [mobile] [desktop]   # the apps named
#   scripts/install-for.sh                      # every app the changes against origin/main reach
#   scripts/install-for.sh --print              # print those apps, one per line
# What both apps share (Core, the client, the theme, the shared Kotlin, the lockfile) reaches both.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

usage() {
  echo "Usage: scripts/install-for.sh [mobile] [desktop] | --print" >&2
  exit 64
}

print_only=false
if [ "${1:-}" = "--print" ]; then
  [ "$#" -eq 1 ] || usage
  print_only=true
  shift
fi

apps=("$@")
for app in "${apps[@]}"; do
  case "$app" in
    mobile|desktop) ;;
    *) usage ;;
  esac
done

if [ "${#apps[@]}" -eq 0 ]; then
  git fetch -q origin main
  mapfile -t apps < <(git diff --no-renames --name-only "origin/main...HEAD" | node scripts/ci/worktree-apps.ts)
fi

if [ "$print_only" = true ]; then
  printf '%s\n' "${apps[@]}"
  exit 0
fi

# The root workspace brings the repo-wide tools check-guards.sh runs (oxlint, react-doctor).
# Both apps have tests that import apps/sync sources, so both also install the sync Worker.
filters=(--filter wave --filter "@wave/sync...")
for app in "${apps[@]}"; do
  filters+=(--filter "@wave/$app...")
done
pnpm install --frozen-lockfile "${filters[@]}"
