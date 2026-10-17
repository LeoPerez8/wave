#!/usr/bin/env bash
# Prints the PRs that may be merged in <since>..<head>, one MergedPr JSON per line
# (scripts/ci/patch-notes.ts): every PR merged on or after the range's oldest commit.
# patch-notes.ts keeps the ones whose merge commit is in the range, for the patch notes and
# for the version bump's size (next-version.ts). Needs the range's history.
#   scripts/ci/merged-prs.sh <since> <head>
# Env: GH_TOKEN, GITHUB_REPOSITORY.
set -euo pipefail

here="$(dirname "$0")"
since="${1:?}"
head="${2:?}"
repo="${GITHUB_REPOSITORY:?}"

# Every PR merged into the range is merged on or after its oldest commit, so the search
# starts there (a day early, for time zones).
oldest="$(git log --format=%cs "$since..$head" | sort | head -n 1)"
[ -n "$oldest" ] || exit 0
from="$(date -u -d "$oldest -1 day" +%F)"

# What a MergedPr is made of, asked of a PullRequest node and shaped by jq.
fields='
  number title url body headRefName baseRefName
  mergeCommit { oid }
  files(first: 100) { totalCount nodes { path } }
  closingIssuesReferences(first: 25) { nodes { number } }'
shape='{
  number, title, url, body,
  branch: .headRefName,
  base: .baseRefName,
  mergeCommit: .mergeCommit.oid,
  files: (if .files.totalCount > (.files.nodes | length) then null else [.files.nodes[].path] end),
  issues: [.closingIssuesReferences.nodes[].number]
}'

found="$(gh api graphql --paginate -f q="repo:$repo is:pr is:merged merged:>=$from" -f query="
  query(\$q: String!, \$endCursor: String) {
    search(query: \$q, type: ISSUE, first: 50, after: \$endCursor) {
      pageInfo { hasNextPage endCursor }
      nodes { ... on PullRequest { $fields } }
    }
  }" --jq ".data.search.nodes[] | $shape")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if [ -n "$found" ]; then printf '%s\n' "$found" | tee "$tmp/found.jsonl"; else : > "$tmp/found.jsonl"; fi

# The search can lag a minute or more behind a merge, so it may not have the PR this push
# merged yet. Every PR merged into <head>'s branch lands on its first-parent line: ask
# GitHub directly (commits/<sha>/pulls isn't searched) which PR merged each of those commits
# the search's PRs don't account for. Version bumps and direct pushes have none.
git rev-list --first-parent "$since..$head" > "$tmp/first-parent.txt"
node "$here/merged-prs.ts" "$tmp/first-parent.txt" < "$tmp/found.jsonl" > "$tmp/unclaimed.txt"
owner="${repo%%/*}"
name="${repo#*/}"
while read -r sha; do
  numbers="$(gh api "repos/$repo/commits/$sha/pulls" \
    --jq ".[] | select(.merged_at != null and .merge_commit_sha == \"$sha\") | .number")"
  for number in $numbers; do
    echo "::notice::GitHub's search doesn't list #$number yet; asked for it by its merge commit ${sha:0:7}." >&2
    gh api graphql -f owner="$owner" -f name="$name" -F number="$number" -f query="
      query(\$owner: String!, \$name: String!, \$number: Int!) {
        repository(owner: \$owner, name: \$name) { pullRequest(number: \$number) { $fields } }
      }" --jq ".data.repository.pullRequest | $shape"
  done
done < "$tmp/unclaimed.txt"
