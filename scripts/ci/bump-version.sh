#!/usr/bin/env bash
# Pushes to main and ti: releases the next version (docs/spec.md, Releases; ti's end in -ti).
# next-version.ts picks it from the repo's v* tags, one counter for both branches, what changed
# since the branch's previous release (previous-tag.sh) and the PRs merged since then
# (merged-prs.sh; one from a feat/ branch that no release shipped yet makes it a minor bump).
# When the push releases, this writes the version into apps/mobile/package.json, commits that
# alone as "Release Wave <version>" and pushes it to the branch with the workflow's token,
# which doesn't start another run. If the branch moved on meanwhile, it starts over from its
# new tip. A commit already tagged for its channel is released as it is.
# Writes `tag=v<version>` (empty when nothing is released) and `sha=<commit>` (the commit the
# rest of the run checks, builds and tags) to $GITHUB_OUTPUT.
#   scripts/ci/bump-version.sh main|ti
# Run from a checkout of that branch (HEAD on its tip). Env: GITHUB_OUTPUT, GH_TOKEN,
# GITHUB_REPOSITORY.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../.."
branch="${1:-}"
channel=()
case "$branch" in
  main) ;;
  ti) channel=(--ti) ;;
  *) echo "::error::Only main and ti release a version, not \"$branch\"." >&2; exit 1 ;;
esac
package=apps/mobile/package.json
out="${GITHUB_OUTPUT:-/dev/null}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch() {
  git fetch --quiet --tags "$@" origin "+refs/heads/$branch:refs/remotes/origin/$branch"
}

# The previous release and every commit since it need the whole history.
unshallow=()
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then unshallow=(--unshallow); fi
fetch "${unshallow[@]}"

for attempt in 1 2 3 4 5; do
  git tag --list 'v*' > "$tmp/tags.txt"
  git tag --points-at HEAD --list 'v*' > "$tmp/own.txt"
  # The branch's previous release, as patch-notes.sh picks it.
  since="$("$here/previous-tag.sh" HEAD "$branch")"
  inputs=()
  if [ -n "$since" ]; then
    # Both names of a moved file, as in changes.sh.
    git diff --name-only --no-renames "$since" HEAD > "$tmp/changed.txt"
    # So a version bump merged from the other branch doesn't count as a change.
    git show "$since:$package" > "$tmp/previous-package.json" 2> /dev/null \
      || : > "$tmp/previous-package.json"
    # The PRs merged since then that the patch notes list decide the bump's size, less the
    # ones a v* tag of either channel already contains.
    git rev-list "$since..HEAD" > "$tmp/commits.txt"
    git rev-list HEAD --not --tags='v*' > "$tmp/unreleased.txt"
    "$here/merged-prs.sh" "$since" HEAD > "$tmp/prs.jsonl"
    inputs=(--changed "$tmp/changed.txt" --previous-package "$tmp/previous-package.json"
      --commits "$tmp/commits.txt" --unreleased "$tmp/unreleased.txt" --prs "$tmp/prs.jsonl")
    echo "::group::Changed since $since"
    cat "$tmp/changed.txt"
    echo "::endgroup::"
  else
    echo "No version tag in $branch's history: everything counts as changed."
  fi

  current="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$package")"
  echo "The app's version is $current ($package)."
  version="$(node "$here/next-version.ts" ${channel[@]+"${channel[@]}"} --package "$package" \
    --tags "$tmp/tags.txt" --own "$tmp/own.txt" ${inputs[@]+"${inputs[@]}"} \
    | sed -n 's/^version=//p')"

  if [ -z "$version" ]; then
    { echo "tag="; echo "sha=$(git rev-parse HEAD)"; } | tee -a "$out"
    exit 0
  fi

  # A version set by hand, or one an earlier run committed but didn't release, is on the
  # branch already: the release goes on this commit.
  if [ "$current" = "$version" ]; then
    echo "$package already says $version, so there's nothing to commit."
    { echo "tag=v$version"; echo "sha=$(git rev-parse HEAD)"; } | tee -a "$out"
    exit 0
  fi

  node -e '
    const fs = require("fs");
    const [path, version] = process.argv.slice(1);
    const text = fs.readFileSync(path, "utf8");
    const updated = text.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`);
    if (updated === text) throw new Error(`No "version" field to update in ${path}.`);
    fs.writeFileSync(path, updated);
  ' "$package" "$version"
  git add "$package"
  git -c user.name="github-actions[bot]" \
    -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit -q -m "Release Wave $version"
  git show --stat --oneline HEAD

  if git push --quiet origin "HEAD:refs/heads/$branch"; then
    { echo "tag=v$version"; echo "sha=$(git rev-parse HEAD)"; } | tee -a "$out"
    exit 0
  fi

  echo "::warning::$branch moved on before the version bump was pushed (try $attempt of 5). Starting over from its new tip."
  fetch
  git reset --quiet --hard "origin/$branch"
done

echo "::error::Couldn't push the version bump to $branch after 5 tries."
exit 1
