#!/usr/bin/env bash
# Posts (or updates) the sticky PR comments the run's jobs wrote with report.sh, one per job.
# Jobs that run the PR's code have read-only tokens, so they hand their comments over as
# ci-report-* artifacts, and the Report job, which runs none of that code, posts them. A file
# that holds only its marker deletes that job's earlier comment.
#   scripts/ci/post-reports.sh <dir>
# Env: GH_TOKEN, PR_NUMBER, GITHUB_REPOSITORY.
set -euo pipefail

dir="${1:?}"
repo="${GITHUB_REPOSITORY:?}"
pr="${PR_NUMBER:?}"
marker_re='^<!-- wave-ci:[A-Za-z0-9 .-]+ -->$'

shopt -s nullglob
files=("$dir"/*.md)
if [ "${#files[@]}" = 0 ]; then
  echo "No comments to post."
  exit 0
fi

# Each sticky comment's id and first line, which is its marker.
existing="$(gh api "repos/$repo/issues/$pr/comments" --paginate \
  --jq '.[] | select(.body | startswith("<!-- wave-ci:")) | "\(.id)\t\(.body | split("\n")[0])"')"

for file in "${files[@]}"; do
  marker="$(head -n 1 "$file")"
  if ! [[ "$marker" =~ $marker_re ]]; then
    echo "::warning::Skipped $(basename "$file"): it doesn't start with a wave-ci marker."
    continue
  fi
  id="$(printf '%s\n' "$existing" | awk -F '\t' -v m="$marker" '$2 == m { id = $1 } END { print id }')"
  if [ -z "$(tail -n +2 "$file" | tr -d '[:space:]')" ]; then
    if [ -n "$id" ]; then gh api -X DELETE "repos/$repo/issues/comments/$id"; fi
  elif [ -n "$id" ]; then
    gh api -X PATCH "repos/$repo/issues/comments/$id" -F "body=@$file" > /dev/null
  else
    gh api "repos/$repo/issues/$pr/comments" -F "body=@$file" > /dev/null
  fi
done
