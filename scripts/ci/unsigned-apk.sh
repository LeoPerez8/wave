#!/usr/bin/env bash
# Drops an APK's signature and aligns it, for the release job to sign (sign-apk.sh). Gradle
# signs its release output with prebuild's debug keystore, which is public; the Android job
# hands on, and keeps for repacks, only what this leaves, which no phone installs.
#   scripts/ci/unsigned-apk.sh <apk> <output apk>
# Env: ANDROID_HOME.
set -euo pipefail

input="$(realpath "$1")"
output="$(realpath -m "$2")"
tools="$(ls -d "${ANDROID_HOME:?}"/build-tools/* | sort -V | tail -n 1)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cp "$input" "$work/in.apk"
# The v1 (JAR) signature's files. zipalign drops the v2 and v3 signing block.
mapfile -t jar_signature < <(unzip -Z1 "$work/in.apk" |
  grep -E '^META-INF/([^/]+\.(SF|RSA|DSA|EC)|MANIFEST\.MF)$' || true)
if [ "${#jar_signature[@]}" -gt 0 ]; then zip -q -d "$work/in.apk" "${jar_signature[@]}"; fi
# -P 16: native libraries stay aligned to 16 KB pages, as AGP aligns them.
"$tools/zipalign" -P 16 -f 4 "$work/in.apk" "$output"

if "$tools/apksigner" verify "$output" > /dev/null 2>&1; then
  echo "$output still carries a signature." >&2
  exit 1
fi
