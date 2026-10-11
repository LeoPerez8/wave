#!/usr/bin/env bash
# PR-only: brings the lockfile up to date and applies formatting, then commits
# the result back to the PR branch. Agent sessions working on this repo can't
# reach the npm registry, so CI is where the lockfile gets resolved.
#   HEAD_REF must name the PR branch.
set -euo pipefail

if [ ! -f pnpm-lock.yaml ]; then
  scripts/ci/bootstrap-deps.sh
fi

pnpm install --no-frozen-lockfile
pnpm fmt

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git -c user.name="github-actions[bot]" \
    -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit -q -m "chore: update lockfile and formatting"
  git push -q origin "HEAD:${HEAD_REF:?}"
  echo "Committed lockfile/formatting changes:"
  git show --stat --oneline HEAD
fi

echo "sha=$(git rev-parse HEAD)" >> "${GITHUB_OUTPUT:-/dev/null}"
