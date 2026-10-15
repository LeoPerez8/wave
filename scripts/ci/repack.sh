#!/usr/bin/env bash
# Builds the APK without Gradle, from a kept full build whose native side matches this one
# (repack.ts decides when). bundle.sh has already produced the JS/Hermes bundle once.
# This swaps it into the kept APK, then aligns and signs with that build's debug keystore.
#   scripts/ci/repack.sh <kept dir> <output apk>
# The kept dir holds app-release.apk, debug.keystore and metro-assets.json (Metro's assets
# folder in that build, from `repack.ts assets`). Run it after prebuild, from the repo root.
# When Metro emits assets the kept APK doesn't have, it writes no APK and prints why: those are
# Android resources, which only Gradle can build in. Env: ANDROID_HOME, RUNNER_TEMP.
set -euo pipefail

kept="$(realpath "$1")"
output="$(realpath -m "$2")"
here="$(realpath "$(dirname "$0")")"
app="$(realpath apps/mobile)"
work="${RUNNER_TEMP:-/tmp}/repack"
rm -rf "$work"
mkdir -p "$work/bundle/assets" "$work/res"
assets="$app/android/app/build/generated/assets/react/release"
resources="$app/android/app/build/generated/res/react/release"
test -s "${WAVE_CI_BUNDLE_MANIFEST:?}"
test -s "$assets/index.android.bundle"

missing="$(node "$here/repack.ts" check-assets "$kept/metro-assets.json" "$resources")"
if [ -n "$missing" ]; then
  echo "The kept APK lacks these assets, so this needs a full build:"
  echo "$missing"
  exit 0
fi

# The bundle is stored uncompressed, as Gradle stores it (enableBundleCompression is off),
# so Hermes can map it.
unzip -l "$kept/app-release.apk" assets/index.android.bundle > /dev/null
cp -a "$assets/." "$work/bundle/assets/"
cp "$kept/app-release.apk" "$work/unsigned.apk"
(cd "$work/bundle" && zip -q -0 -X -r "$work/unsigned.apk" assets)

tools="$(ls -d "${ANDROID_HOME:?}"/build-tools/* | sort -V | tail -n 1)"
# -P 16: native libraries stay aligned to 16 KB pages, as AGP aligns them.
"$tools/zipalign" -P 16 -f 4 "$work/unsigned.apk" "$work/aligned.apk"
"$tools/apksigner" sign --ks "$kept/debug.keystore" --ks-pass pass:android \
  --ks-key-alias androiddebugkey --key-pass pass:android --out "$output" "$work/aligned.apk"

# It must install over the kept build: same signer, package and versionCode.
signer() { "$tools/apksigner" verify --print-certs "$1" | grep 'certificate SHA-256 digest'; }
package() { "$tools/aapt2" dump badging "$1" | grep '^package:'; }
signer "$output"
package "$output"
if [ "$(signer "$output")" != "$(signer "$kept/app-release.apk")" ] ||
  [ "$(package "$output")" != "$(package "$kept/app-release.apk")" ]; then
  echo "The repacked APK's signer or package differs from the kept build's." >&2
  exit 1
fi
