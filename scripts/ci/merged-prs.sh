#!/usr/bin/env bash
# Prints the PRs that may be merged in <since>..<head>, one MergedPr JSON per line
# (scripts/ci/patch-notes.ts): every PR merged on or after the range's oldest commit.
# patch-notes.ts keeps the ones whose merge commit is in the range, for the patch notes and
# for the version bump's size (next-version.ts). Needs the range's history.
#   scripts/ci/merged-prs.sh <since> <head>
# Env: GH_TOKEN, GITHUB_REPOSITORY.
set -euo pipefail

since="${1:?}"
head="${2:?}"
repo="${GITHUB_REPOSITORY:?}"

# Every PR merged into the range is merged on or after its oldest commit, so the search
# starts there (a day early, for time zones).
oldest="$(git log --format=%cs "$since..$head" | sort | head -n 1)"
[ -n "$oldest" ] || exit 0
from="$(date -u -d "$oldest -1 day" +%F)"

gh api graphql --paginate -f q="repo:$repo is:pr is:merged merged:>=$from" -f query='
  query($q: String!, $endCursor: String) {
    search(query: $q, type: ISSUE, first: 50, after: $endCursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number title url body headRefName baseRefName
          mergeCommit { oid }
          files(first: 100) { totalCount nodes { path } }
          closingIssuesReferences(first: 25) { nodes { number } }
        }
      }
    }
  }' --jq '.data.search.nodes[] | {
    number, title, url, body,
    branch: .headRefName,
    base: .baseRefName,
    mergeCommit: .mergeCommit.oid,
    files: (if .files.totalCount > (.files.nodes | length) then null else [.files.nodes[].path] end),
    issues: [.closingIssuesReferences.nodes[].number]
  }'
