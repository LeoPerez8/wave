#!/usr/bin/env bash
# Pushes to main: releases the next -ti version to the ti channel (docs/spec.md, Releases).
# next-version.ts picks it from the repo's v* tags, what changed since the previous -ti release
# (previous-tag.sh) and the PRs merged since then
# (merged-prs.sh; one from a feat/ branch that no release shipped yet makes it a minor bump).
# When the push releases, this writes the version into apps/mobile/package.json, commits that
# alone as "Release Wave <version>" and pushes it to the branch together with its v<version>
# tag, in one atomic push with the workflow's token, which doesn't start another run. The tag
# takes the number as soon as it's picked, so the next bump counts past it even before this run
# publishes the release. If the branch moved on or the tag was taken meanwhile, it starts
# over from the new tip; any other rejected push fails. A tip already tagged for its channel
# (a re-run after its bump was pushed) is released as it is, with nothing pushed.
# Writes `tag=v<version>` (empty when nothing is released) and `sha=<commit>` (the commit the
# rest of the run checks and builds, which the tag is on) to $GITHUB_OUTPUT.
#   scripts/ci/bump-version.sh main
# Run from a checkout of main (HEAD on its tip). Env: GITHUB_OUTPUT, GH_TOKEN,
# GITHUB_REPOSITORY.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../.."
branch="${1:-}"
if [ "$branch" != main ]; then
  echo "::error::Only main releases a version, not \"$branch\"." >&2
  exit 1
fi
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
  # The ti channel's previous release, as patch-notes.sh picks it.
  since="$("$here/previous-tag.sh" HEAD ti)"
  inputs=()
  if [ -n "$since" ]; then
    # Both names of a moved file, as in changes.sh.
    git diff --name-only --no-renames "$since" HEAD > "$tmp/changed.txt"
    # So a change of the version alone doesn't count.
    git show "$since:$package" > "$tmp/previous-package.json" 2> /dev/null \
      || : > "$tmp/previous-package.json"
    # The PRs merged since then that the patch notes list decide the bump's size, less the
    # ones a v* tag already contains.
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
  version="$(node "$here/next-version.ts" --ti --package "$package" \
    --tags "$tmp/tags.txt" --own "$tmp/own.txt" ${inputs[@]+"${inputs[@]}"} \
    | sed -n 's/^version=//p')"

  if [ -z "$version" ]; then
    { echo "tag="; echo "sha=$(git rev-parse HEAD)"; } | tee -a "$out"
    exit 0
  fi

  tag="v$version"
  if git tag --points-at HEAD --list "$tag" | grep -qxF "$tag"; then
    echo "$branch's tip is already $tag: nothing to bump or push."
    { echo "tag=$tag"; echo "sha=$(git rev-parse HEAD)"; } | tee -a "$out"
    exit 0
  fi

  base="$(git rev-parse HEAD)"
  if [ "$current" = "$version" ]; then
    # A version set by hand (a major bump), or one an earlier run committed without its tag,
    # is on the branch already: the tag goes on this commit.
    echo "$package already says $version, so there's nothing to commit."
  else
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
  fi

  git tag "$tag"
  refs=("refs/tags/$tag")
  if [ "$(git rev-parse HEAD)" != "$base" ]; then refs=("HEAD:refs/heads/$branch" "${refs[@]}"); fi
  # The commit and its tag land together or not at all.
  if git push --atomic --quiet origin "${refs[@]}" 2> "$tmp/push.txt"; then
    { echo "tag=$tag"; echo "sha=$(git rev-parse HEAD)"; } | tee -a "$out"
    exit 0
  fi
  cat "$tmp/push.txt" >&2
  git tag -d "$tag" > /dev/null
  fetch

  # Starting over only helps when someone else's push got in first.
  moved=false
  if [ "$(git rev-parse "origin/$branch")" != "$base" ]; then moved=true; fi
  taken=false
  if git rev-parse --quiet --verify "refs/tags/$tag" > /dev/null; then taken=true; fi
  if [ "$moved" = false ] && [ "$taken" = false ]; then
    echo "::error::The push of $tag to $branch was rejected (git's error above), and neither $branch nor $tag changed meanwhile, so trying again wouldn't help."
    exit 1
  fi

  if [ "$moved" = true ]; then
    echo "::warning::$branch moved on before $tag was pushed (try $attempt of 5). Starting over from its new tip."
  else
    echo "::warning::$tag was taken before this run pushed it (try $attempt of 5). Starting over."
  fi
  git reset --quiet --hard "origin/$branch"
done

echo "::error::Couldn't push the version bump to $branch after 5 tries."
exit 1
