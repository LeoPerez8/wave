#!/usr/bin/env bash
# Runs one CI step, keeping its output so a failure can be reported on the PR.
#   scripts/ci/step.sh "<step name>" <command> [args...]
set -uo pipefail

name="$1"
shift
dir="${RUNNER_TEMP:-/tmp}"

echo "$name" > "$dir/ci-step-name"
echo "::group::$name"
"$@" 2>&1 | tee "$dir/ci-step.log"
status="${PIPESTATUS[0]}"
echo "::endgroup::"
exit "$status"
