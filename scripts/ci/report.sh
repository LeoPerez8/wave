#!/usr/bin/env bash
# Writes the job's sticky PR comment with its outcome to $RUNNER_TEMP/ci-report/<job>.md. On
# failure it includes the tail of the failing step's output, so the result is readable without
# access to the Actions logs. The job uploads that folder as a ci-report-* artifact, and the
# Report job posts it (scripts/ci/post-reports.sh): jobs that run the PR's code can't comment.
#   scripts/ci/report.sh <success|failure|skipped> "<job name>" [extra markdown]
# Env: GH_TOKEN (read access to the run's jobs), HEAD_SHA, GITHUB_* (provided by Actions).
set -euo pipefail

status="$1"
job="$2"
extra="${3:-}"
dir="${RUNNER_TEMP:-/tmp}"
repo="${GITHUB_REPOSITORY:?}"
sha="${HEAD_SHA:-$GITHUB_SHA}"
run_url="${GITHUB_SERVER_URL}/${repo}/actions/runs/${GITHUB_RUN_ID}"
marker="<!-- wave-ci:${job} -->"
mkdir -p "$dir/ci-report"
body="$dir/ci-report/$(printf '%s' "$job" | tr 'A-Z ' 'a-z-' | tr -cd 'a-z0-9.-').md"

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
    first="$(grep -n -m1 -E '(^|[^a-zA-Z])(SyntaxError|TransformError|Error|ERROR|error:|FAILURE|Cannot find)' "$clean" | cut -d: -f1 || true)"
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
  # How long the job and each step took, so agents without the Actions API can see
  # where the time goes. The API lags behind the runner, so retry until it shows this
  # step (named "Report" in the workflow) running; past that, use what it has.
  # A skipped job has no steps to time.
  durations=""
  [ "$status" = "skipped" ] || for _ in $(seq 1 15); do
    if durations="$(gh api "repos/${repo}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT:-1}/jobs" \
      --jq ".jobs[] | select(.name == \"${job}\")" \
      | node "$(dirname "$0")/step-durations-cli.ts" "Report")"; then
      break
    fi
    sleep 2
  done
  if [ -n "$durations" ]; then
    echo
    echo "$durations"
  fi
} > "$body"
