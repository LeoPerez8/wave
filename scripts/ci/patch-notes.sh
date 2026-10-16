#!/usr/bin/env bash
# Prints the patch notes of a release cut from <ref> (default HEAD): the PRs merged since
# the previous version's tag, as patch-notes.ts sorts them into New and Fixes. With no
# previous version tag (0.5.0, the first), they're the hand-written
# docs/first-release-notes.md. Prints nothing when no PR is worth listing.
# Needs the whole history and its tags (actions/checkout with fetch-depth: 0).
#   scripts/ci/patch-notes.sh [<ref>]
# Env: GH_TOKEN, GITHUB_REPOSITORY, PATCH_NOTES_SINCE (optional: count from this ref
# instead of the previous version's tag).
set -euo pipefail

here="$(dirname "$0")"
head="${1:-HEAD}"
repo="${GITHUB_REPOSITORY:?}"

since="${PATCH_NOTES_SINCE:-}"
if [ -z "$since" ]; then
  # The newest version tag in <ref>'s history, leaving out <ref>'s own tag.
  own="$(git tag --points-at "$head" --list 'v[0-9]*')"
  versions="$(git tag --merged "$head" --list 'v[0-9]*' --sort=-v:refname \
    | { grep -vxF -e "$own" || true; })"
  if [ "${IS_TI:-false}" = "true" ]; then
    since="$(printf '%s\n' "$versions" | { grep -E '^v[0-9]+\.[0-9]+\.[0-9]+-ti$' || true; } | head -n 1)"
  fi
  # The first ti release starts at the last stable version; stable notes never
  # treat a ti prerelease as their previous stable version.
  if [ -z "$since" ]; then
    since="$(printf '%s\n' "$versions" | { grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true; } | head -n 1)"
  fi
fi
if [ -z "$since" ]; then
  cat "$here/../../docs/first-release-notes.md"
  exit 0
fi

commits="$(git rev-list "$since..$head")"
[ -n "$commits" ] || exit 0

# Every PR merged into the release is merged on or after its oldest commit, so the
# search starts there (a day early, for time zones) and patch-notes.ts keeps the PRs
# whose merge commit is one of the release's.
oldest="$(git log --format=%cs "$since..$head" | sort | head -n 1)"
from="$(date -u -d "$oldest -1 day" +%F)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "$commits" > "$tmp/commits.txt"
gh issue list --repo "$repo" --label bug --state all --limit 1000 --json number \
  --jq '.[].number' > "$tmp/bugs.txt"

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
  }' > "$tmp/prs.jsonl"

node "$here/patch-notes.ts" "$tmp/commits.txt" "$tmp/bugs.txt" < "$tmp/prs.jsonl"
