#!/usr/bin/env bash
# Merges a ticket branch into an integration branch in a throwaway worktree, checks the
# result and pushes it, so a clean merge needs no agent. Never run two at once on one branch.
#   scripts/merge-ticket.sh <ticket-branch> <integration-branch> "<merge message>"
# Exit codes: 0 pushed; 2 conflict, so nothing changed and an agent should merge by hand;
# 1 typecheck or guards failed, or the push lost a race. Nothing was pushed in either case.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  sed -n 4p "$0" >&2
  exit 64
fi
ticket="$1"
integration="$2"
message="$3"
here="$(realpath "$(dirname "$0")")"

git fetch -q origin "$ticket" "$integration"
common="$(git rev-parse --path-format=absolute --git-common-dir)"
mkdir -p "$common/../.worktrees"
work="$(mktemp -d "$(realpath "$common/..")/.worktrees/merge-XXXXXX")"
git worktree add -q --detach "$work" "origin/$integration"
trap 'git -C "$common" worktree remove --force "$work"' EXIT
cd "$work"

if ! git merge -q --no-ff --no-verify -m "$message" "origin/$ticket"; then
  echo "Conflict merging $ticket into $integration:" >&2
  git diff --name-only --diff-filter=U >&2
  exit 2
fi

pnpm install -s --frozen-lockfile --prefer-offline
pnpm -s typecheck
"$here/check-guards.sh"
git push -q origin "HEAD:refs/heads/$integration"
echo "$integration is at $(git rev-parse HEAD)"
