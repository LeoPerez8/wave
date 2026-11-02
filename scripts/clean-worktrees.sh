#!/usr/bin/env bash
# Lists the worktrees that can go: merged into origin/main, nothing uncommitted, and idle.
# Pass --apply to remove them. It never removes anything else; it prints those to decide on.
#   scripts/clean-worktrees.sh [--apply]
set -uo pipefail

idle_minutes=120
apply=false
[ "${1:-}" = "--apply" ] && apply=true

git fetch -q origin main
main_checkout="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"

in_use() {
  local dir
  for dir in /proc/[0-9]*/cwd; do
    case "$(readlink "$dir" 2>/dev/null)/" in "$1"/*) return 0 ;; esac
  done
  return 1
}

git worktree prune
git worktree list --porcelain | sed -n 's/^worktree //p' | while read -r path; do
  [ "$path" = "$main_checkout" ] && continue
  reason=""
  if ! git merge-base --is-ancestor "$(git -C "$path" rev-parse HEAD)" origin/main; then
    reason="not merged"
  elif [ -n "$(git -C "$path" status --porcelain)" ]; then
    reason="uncommitted changes"
  elif [ -n "$(find "$(git -C "$path" rev-parse --git-dir)" -maxdepth 1 -mmin "-$idle_minutes" -print -quit)" ]; then
    reason="used in the last $idle_minutes min"
  elif in_use "$path"; then
    reason="a process runs inside it"
  fi
  if [ -n "$reason" ]; then
    echo "keep   $path ($reason)"
  elif $apply; then
    git worktree remove --force "$path" && echo "removed $path"
  else
    echo "remove $path"
  fi
done
