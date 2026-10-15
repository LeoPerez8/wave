#!/usr/bin/env bash
# Posts the Android APK comment for a PR whose change can't alter the APK,
# linking the last APK this PR built, if it has one.
# Env: GH_TOKEN, PR_NUMBER, HEAD_SHA, GITHUB_* (provided by Actions).
set -euo pipefail

asset="wave-pr-${PR_NUMBER:?}.apk"
last="$(gh release view "pr-${PR_NUMBER}" --repo "${GITHUB_REPOSITORY:?}" --json assets \
  --jq ".assets[] | select(.name == \"${asset}\") | \"\(.url) \(.updatedAt)\"" 2>/dev/null || true)"

text="Nothing in the app changed, so the APK wasn't built."
if [ -n "$last" ]; then
  url="${last%% *}"
  built="${last#* }"
  text="${text}"$'\n\n'"📱 **[Download the PR's last APK](${url})** (built ${built:0:10})"
else
  text="${text} This PR has no APK yet."
fi

"$(dirname "$0")/report.sh" skipped "Android APK" "$text"
