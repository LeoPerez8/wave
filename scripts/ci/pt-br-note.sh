#!/usr/bin/env bash
# Keeps one comment on a PR the patch notes will list and that has no `pt-BR: …` line, and
# removes it once the line is there. A feature branch's PR isn't listed when its tickets' PRs
# into that branch are. It only ever warns: the PR's note falls back to its English title.
#   scripts/ci/pt-br-note.sh
# Env: GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER.
set -euo pipefail

here="$(dirname "$0")"
repo="${GITHUB_REPOSITORY:?}"
pr="${PR_NUMBER:?}"
marker="<!-- wave-ci:pt-BR note -->"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

gh api "repos/$repo/pulls/$pr" --jq '.body // ""' > "$tmp/body.txt"
head="$(gh api "repos/$repo/pulls/$pr" --jq '.head.ref')"
gh api "repos/$repo/pulls/$pr/files" --paginate --jq '.[].filename' > "$tmp/files.txt"
tickets="$(gh pr list --repo "$repo" --base "$head" --state merged --limit 1 --json number --jq length)"

needed="$(node "$here/localized-notes.ts" --needs-note "$tmp/files.txt" < "$tmp/body.txt")"
[ "$tickets" = "0" ] || needed=no

existing="$(gh api "repos/$repo/issues/$pr/comments" --paginate \
  --jq ".[] | select(.body | startswith(\"$marker\")) | .id" | tail -n 1)"

if [ "$needed" = "no" ]; then
  if [ -n "$existing" ]; then gh api -X DELETE "repos/$repo/issues/comments/$existing"; fi
  exit 0
fi

cat > "$tmp/comment.md" <<EOF
$marker
### ⚠️ No Portuguese release note

The patch notes will list this PR, and its body has no \`pt-BR: …\` line. Add one with the title's
Brazilian Portuguese wording, or Portuguese readers get the English title. This doesn't block
anything.
EOF
if [ -n "$existing" ]; then
  gh api -X PATCH "repos/$repo/issues/comments/$existing" -F "body=@$tmp/comment.md" > /dev/null
else
  gh api "repos/$repo/issues/$pr/comments" -F "body=@$tmp/comment.md" > /dev/null
fi
