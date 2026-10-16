#!/usr/bin/env bash
# Pushes to main only: releases the next version (docs/spec.md, Releases). next-version.ts
# picks it from the repo's v* tags and what changed since main's previous release. When the
# push releases, this writes the version into apps/mobile/package.json, commits that alone as
# "Release Wave <version>" and pushes it to main with the workflow's token, which doesn't start
# another run. If main moved on meanwhile, it starts over from main's new tip.
# Writes `tag=v<version>` (empty when nothing is released) and `sha=<commit>` (the commit the
# rest of the run checks, builds and tags) to $GITHUB_OUTPUT.
#   scripts/ci/bump-version.sh
# Run from a checkout of main (HEAD on its tip). Env: GITHUB_OUTPUT.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../.."
branch=main
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
  # main's previous release: the newest stable version tag in its history.
  since="$(git tag --merged HEAD --list 'v[0-9]*' --sort=-v:refname \
    | { grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true; } | head -n 1)"
  changed=()
  if [ -n "$since" ]; then
    # Both names of a moved file, as in changes.sh.
    git diff --name-only --no-renames "$since" HEAD > "$tmp/changed.txt"
    changed=("$tmp/changed.txt")
    echo "::group::Changed since $since"
    cat "$tmp/changed.txt"
    echo "::endgroup::"
  else
    echo "No stable version tag in main's history: everything counts as changed."
  fi

  current="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$package")"
  echo "The app's version is $current ($package)."
  version="$(node "$here/next-version.ts" "$current" "$tmp/tags.txt" ${changed[@]+"${changed[@]}"} \
    | sed -n 's/^version=//p')"

  if [ -z "$version" ]; then
    { echo "tag="; echo "sha=$(git rev-parse HEAD)"; } | tee -a "$out"
    exit 0
  fi

  # A version set by hand, or one an earlier run committed but didn't release, is on main
  # already: the release goes on this commit.
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
