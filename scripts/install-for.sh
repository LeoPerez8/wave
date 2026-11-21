#!/usr/bin/env bash
# Install one app and its workspace dependencies in this worktree.
# With no app, infer it from paths changed against origin/main.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

app="${1:-}"
print_only=false
if [ "$app" = "--print" ]; then
  app=""
  print_only=true
fi
if [ "$#" -gt 1 ]; then
  echo "Usage: scripts/install-for.sh [mobile|desktop|--print]" >&2
  exit 64
fi

if [ -z "$app" ]; then
  git fetch -q origin main
  areas="$(git diff --name-only "origin/main...HEAD" | node scripts/ci/changes.ts)"
  desktop="$(printf '%s\n' "$areas" | sed -n 's/^desktop=//p')"
  phone="$(printf '%s\n' "$areas" | sed -n 's/^app=//p')"

  # Shared changes can affect both builds. Prefer mobile as the default; choose
  # desktop automatically only when its area changed without the phone's area.
  if [ "$desktop" = true ] && [ "$phone" != true ]; then
    app=desktop
  else
    app=mobile
  fi
fi

if [ "$print_only" = true ]; then
  printf '%s\n' "$app"
  exit 0
fi

case "$app" in
  mobile|desktop) ;;
  *)
    echo "Usage: scripts/install-for.sh [mobile|desktop|--print]" >&2
    exit 64
    ;;
esac

# The root workspace brings the repo-wide tools check-guards.sh runs (oxlint, react-doctor).
# Both apps have tests that import apps/sync sources, so both also install the sync Worker.
pnpm install --frozen-lockfile --filter wave --filter "@wave/$app..." --filter "@wave/sync..."
