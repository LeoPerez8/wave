#!/usr/bin/env bash
# Fails when commits carry a secret, by gitleaks with the repo's .gitleaks.toml. Findings print
# with their values redacted. .gitleaksignore lists single findings checked and found harmless.
#   scripts/ci/secret-scan.sh [<git log range>]     e.g. "<base>..<head>", "-1 <sha>", "--all"
# With no range it scans what the CI event brings in: a PR's commits, a push's new commits, or
# the one commit of a tag push or a dispatch. It checks itself first: a fake secret it plants in
# a scratch repo must fail the scan. GITLEAKS=<binary> skips downloading the pinned release.
set -euo pipefail

version=8.30.1
sha256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb

root="$(git rev-parse --show-toplevel)"
config="$root/.gitleaks.toml"
ignore="$root/.gitleaksignore"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

gitleaks="${GITLEAKS:-}"
if [ -z "$gitleaks" ]; then
  archive="$work/gitleaks.tar.gz"
  curl -fsSL -o "$archive" \
    "https://github.com/gitleaks/gitleaks/releases/download/v$version/gitleaks_${version}_linux_x64.tar.gz"
  echo "$sha256  $archive" | sha256sum -c --quiet -
  tar -xzf "$archive" -C "$work" gitleaks
  gitleaks="$work/gitleaks"
fi

scan() { "$gitleaks" git --no-banner --redact --config "$config" --gitleaks-ignore-path "$ignore" "$@"; }

# The self-check: a scan that misses a planted secret, or can't read its config, proves nothing.
planted="$work/planted"
git init -q "$planted"
fake="$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
printf 'export const apiKey = "%s";\n' "$fake" > "$planted/config.ts"
git -C "$planted" add config.ts
git -C "$planted" -c user.name=ci -c user.email=ci@localhost commit -q -m planted
scan "$planted" --exit-code 0 --report-format json --report-path "$work/planted.json" > /dev/null 2>&1 || true
if ! grep -qs '"generic-api-key"' "$work/planted.json"; then
  echo "The secret scan missed a planted fake secret: check .gitleaks.toml." >&2
  exit 1
fi

range="${1:-}"
here="$(cd "$(dirname "$0")" && pwd)"
source_sha="${SOURCE_SHA:-}"
if [ -z "$range" ] && [ -n "$source_sha" ]; then
  # The run's release source (docs/release-provenance.md): the checkout must be that commit,
  # and the scan covers everything it adds since the channel's previous release, so the
  # version bump and autofix commits CI made count, as do pushes that never got a run.
  if [ "$(git rev-parse HEAD)" != "$source_sha" ]; then
    echo "The checkout is $(git rev-parse HEAD), not the release source $source_sha." >&2
    exit 1
  fi
  if [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ]; then
    range="${BASE_SHA:?}..$source_sha"
  else
    channel=ti
    if [[ "${GITHUB_REF:-}" == refs/tags/v* && "${GITHUB_REF}" != *-ti ]]; then channel=main; fi
    previous="$("$here/previous-tag.sh" "$source_sha" "$channel")"
    if [ -n "$previous" ]; then
      range="$(git rev-parse "$previous^{commit}")..$source_sha"
    else
      range="$source_sha"
    fi
  fi
fi
if [ -z "$range" ]; then
  zero=0000000000000000000000000000000000000000
  if [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ]; then
    range="${BASE_SHA:?}..${HEAD_SHA:?}"
  elif [ -n "${BEFORE:-}" ] && [ "$BEFORE" != "$zero" ]; then
    # A force push can leave the old tip out of the clone: then all of the new tip's history.
    if git cat-file -e "$BEFORE^{commit}" 2> /dev/null; then
      range="$BEFORE..${GITHUB_SHA:?}"
    else
      range="${GITHUB_SHA:?}"
    fi
  else
    range="-1 ${GITHUB_SHA:?}"
  fi
fi

echo "Scanning $range"
scan "$root" --log-opts="$range" --exit-code 1 --verbose
# The evidence the release gate reads, only once the scan passed.
if [ -n "$source_sha" ]; then
  { echo "source=$source_sha"; echo "range=$range"; } >> "${GITHUB_OUTPUT:-/dev/null}"
fi
