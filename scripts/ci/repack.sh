#!/usr/bin/env bash
# Builds the APK without Gradle, from a kept full build whose native side matches this one
# (repack.ts decides when). It bundles the JS the way Gradle's createBundleReleaseJsAndAssets
# does (Expo CLI's export:embed, then hermesc with the flags in app/build.gradle), swaps the
# bundle into the kept APK, then zipaligns and signs it with the kept build's debug keystore.
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
bundle="$work/bundle/assets/index.android.bundle"

cd "$app"
# The same commands app/build.gradle's react block resolves.
cli="$(node --print "require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] })")"
entry="$(node -e "require('expo/scripts/resolveAppEntry')" "$app" android absolute)"
hermes="$(dirname "$(node --print "require.resolve('hermes-compiler/package.json', { paths: [require.resolve('react-native/package.json')] })")")"
mapfile -t flags < <(node "$here/repack.ts" hermes-flags android/app/build.gradle)

start=$SECONDS
node "$cli" export:embed --platform android --dev false --reset-cache \
  --entry-file "$entry" --bundle-output "$bundle" --assets-dest "$work/res" \
  --sourcemap-output "$work/index.android.bundle.packager.map" --minify false --verbose
echo "Metro: $((SECONDS - start)) s"

missing="$(node "$here/repack.ts" check-assets "$kept/metro-assets.json" "$work/res")"
if [ -n "$missing" ]; then
  echo "The kept APK lacks these assets, so this needs a full build:"
  echo "$missing"
  exit 0
fi

start=$SECONDS
"$hermes/hermesc/linux64-bin/hermesc" -w -emit-binary -max-diagnostic-width=80 \
  -out "$bundle.hbc" "$bundle" "${flags[@]}"
mv "$bundle.hbc" "$bundle"
echo "hermesc ${flags[*]}: $((SECONDS - start)) s"

# The bundle is stored uncompressed, as Gradle stores it (enableBundleCompression is off),
# so Hermes can map it.
unzip -l "$kept/app-release.apk" assets/index.android.bundle > /dev/null
cp "$kept/app-release.apk" "$work/unsigned.apk"
(cd "$work/bundle" && zip -q -0 -X "$work/unsigned.apk" assets/index.android.bundle)

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
