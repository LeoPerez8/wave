#!/usr/bin/env bash
# Posts (or updates) one sticky comment per job on the PR with the job's outcome.
# On failure it includes the tail of the failing step's output, so the result is
# readable without access to the Actions logs.
#   scripts/ci/report.sh <success|failure|skipped> "<job name>" [extra markdown]
# Env: GH_TOKEN, PR_NUMBER, HEAD_SHA, GITHUB_* (provided by Actions).
set -euo pipefail

status="$1"
job="$2"
extra="${3:-}"
dir="${RUNNER_TEMP:-/tmp}"
repo="${GITHUB_REPOSITORY:?}"
pr="${PR_NUMBER:?}"
sha="${HEAD_SHA:-$GITHUB_SHA}"
run_url="${GITHUB_SERVER_URL}/${repo}/actions/runs/${GITHUB_RUN_ID}"
marker="<!-- wave-ci:${job} -->"
body="$dir/ci-comment.md"

{
  echo "$marker"
  if [ "$status" = "success" ]; then
    echo "### ✅ ${job} passed"
  elif [ "$status" = "skipped" ]; then
    echo "### ⏭️ ${job} skipped"
  else
    echo "### ❌ ${job} failed"
  fi
  echo
  echo "Commit \`${sha:0:7}\` · [run](${run_url})"
  if [ -n "$extra" ]; then
    echo
    echo "$extra"
  fi
  if [ "$status" = "failure" ] && [ -f "$dir/ci-step.log" ]; then
    echo
    echo "**Failing step:** $(cat "$dir/ci-step-name" 2>/dev/null || echo unknown)"
    echo
    clean="$dir/ci-step.clean.log"
    sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' "$dir/ci-step.log" > "$clean"
    # The root cause is usually the first error, which can scroll far above the tail.
    first="$(grep -n -m1 -E '(^|[^a-zA-Z])(Error|ERROR|error:|FAILURE|Cannot find)' "$clean" | cut -d: -f1 || true)"
    if [ -n "$first" ]; then
      echo "First error (line $first):"
      echo
      echo '```text'
      sed -n "$((first > 15 ? first - 15 : 1)),$((first + 45))p" "$clean" | cut -c1-400
      echo '```'
      echo
      echo "Last lines:"
      echo
    fi
    echo '```text'
    # Strip ANSI colours, keep the last lines, and cap line length to stay under
    # GitHub's comment size limit.
    tail -n 120 "$clean" | cut -c1-400
    echo '```'
  fi
} > "$body"

existing="$(gh api "repos/${repo}/issues/${pr}/comments" --paginate \
  --jq ".[] | select(.body | startswith(\"${marker}\")) | .id" | tail -n 1)"

if [ -n "$existing" ]; then
  gh api -X PATCH "repos/${repo}/issues/comments/${existing}" -F "body=@${body}" > /dev/null
else
  gh api "repos/${repo}/issues/${pr}/comments" -F "body=@${body}" > /dev/null
fi
