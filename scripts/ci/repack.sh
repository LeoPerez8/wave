#!/usr/bin/env bash
# Builds the APK without Gradle, from a kept full build whose native side matches this one
# (repack.ts decides when). bundle.sh has already produced the JS/Hermes bundle once.
# This swaps it into the kept APK, gives the APK this run's app version, then aligns and signs
# with that build's debug keystore.
#   scripts/ci/repack.sh <kept dir> <output apk>
# The kept dir holds app-release.apk and debug.keystore. Run it after prebuild, from the repo
# root. The kept APK's key covers Metro's assets (Android resources only Gradle can build in),
# so they match this bundle's and only the bundle is swapped. It leaves the app version out
# (ti bumps it on every release), so apk-version.ts writes this run's into the manifest and
# Expo's embedded app config. Env: ANDROID_HOME, RUNNER_TEMP.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
kept="$(realpath "$1")"
output="$(realpath -m "$2")"
app="$(realpath apps/mobile)"
work="${RUNNER_TEMP:-/tmp}/repack"
rm -rf "$work"
mkdir -p "$work/bundle/assets" "$work/version"
assets="$app/android/app/build/generated/assets/react/release"
test -s "${WAVE_CI_BUNDLE_MANIFEST:?}"
test -s "$assets/index.android.bundle"

# The bundle is stored uncompressed, as Gradle stores it (enableBundleCompression is off),
# so Hermes can map it.
unzip -l "$kept/app-release.apk" assets/index.android.bundle > /dev/null
cp -a "$assets/." "$work/bundle/assets/"
cp "$kept/app-release.apk" "$work/unsigned.apk"
(cd "$work/bundle" && zip -q -0 -X -r "$work/unsigned.apk" assets)

# The version prebuild wrote into app/build.gradle, as a full build would package it.
(cd "$work/version" && unzip -q "$kept/app-release.apk" AndroidManifest.xml assets/app.config)
version="$(node "$here/apk-version.ts" "$app/android/app/build.gradle" "$work/version")"
(cd "$work/version" && zip -q -X "$work/unsigned.apk" AndroidManifest.xml assets/app.config)

tools="$(ls -d "${ANDROID_HOME:?}"/build-tools/* | sort -V | tail -n 1)"
# -P 16: native libraries stay aligned to 16 KB pages, as AGP aligns them.
"$tools/zipalign" -P 16 -f 4 "$work/unsigned.apk" "$work/aligned.apk"
"$tools/apksigner" sign --ks "$kept/debug.keystore" --ks-pass pass:android \
  --ks-key-alias androiddebugkey --key-pass pass:android --out "$output" "$work/aligned.apk"

# It must install over the kept build: same signer and package, at this run's version.
signer() { "$tools/apksigner" verify --print-certs "$1" | grep 'certificate SHA-256 digest:' | sed 's/.*digest: //' | sort -u; }
badging() { "$tools/aapt2" dump badging "$1" | grep '^package:'; }
package() { badging "$1" | sed "s/ versionCode='[^']*' versionName='[^']*'//"; }
signer "$output"
badging "$output"
if [ "$(signer "$output")" != "$(signer "$kept/app-release.apk")" ] ||
  [ "$(package "$output")" != "$(package "$kept/app-release.apk")" ]; then
  echo "The repacked APK's signer or package differs from the kept build's." >&2
  exit 1
fi
if [[ "$(badging "$output")" != *" $version "* ]]; then
  echo "The repacked APK isn't at this run's version ($version)." >&2
  exit 1
fi
