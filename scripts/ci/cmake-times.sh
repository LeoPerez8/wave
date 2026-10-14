#!/usr/bin/env bash
# Prints how long each CMake task took, read from the report of a Gradle run with --profile.
# Also appends the table to the job summary when GITHUB_STEP_SUMMARY is set.
#   scripts/ci/cmake-times.sh <gradle project dir>
set -euo pipefail

project="${1:-.}"
profile="$(ls -t "$project"/build/reports/profile/profile-*.html 2> /dev/null | head -n 1 || true)"
if [ -z "$profile" ]; then
  echo "No Gradle profile report under $project/build/reports/profile"
  exit 0
fi

# One table row per line, then keep the task rows whose path names a CMake task.
# Durations look like 0.512s, 1m2.34s or 1h0m3.00s.
table="$(tr -d '\n' < "$profile" | sed 's|<tr>|\n|g' \
  | sed -n 's|.*<td[^>]*>\(:[^<]*CMake[^<]*\)</td><td class="numeric">\([^<]*\)</td>.*|\1 \2|p' \
  | awk '
    function seconds(d,   total, n) {
      total = 0
      if (match(d, /[0-9]+h/)) { total += substr(d, RSTART, RLENGTH - 1) * 3600 }
      if (match(d, /[0-9]+m/)) { total += substr(d, RSTART, RLENGTH - 1) * 60 }
      if (match(d, /[0-9.]+s/)) { total += substr(d, RSTART, RLENGTH - 1) }
      return total
    }
    { s = seconds($2); sum += s; printf "| `%s` | %.1f s |\n", $1, s }
    END { printf "| **All CMake tasks (sum)** | **%.1f s** |\n", sum }
  ')"

{
  echo "#### CMake task times"
  echo
  echo "| Task | Time |"
  echo "|---|---|"
  echo "$table"
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
