#!/usr/bin/env bash
# Builds the release bundle once for both full APK builds and repacks. These are the
# commands RN's BundleHermesCTask runs, with the same entry, compiler and Hermes flags.
# prebuilt-bundle.gradle validates the output before the full build skips that task.
set -euo pipefail

here="$(realpath "$(dirname "$0")")"
app="$(realpath apps/mobile)"
assets="$app/android/app/build/generated/assets/react/release"
resources="$app/android/app/build/generated/res/react/release"
intermediate="$app/android/app/build/intermediates/sourcemaps/react/release"
maps="$app/android/app/build/generated/sourcemaps/react/release"
manifest="${WAVE_CI_BUNDLE_MANIFEST:?}"
rm -f "$manifest"
rm -rf "$assets" "$resources" "$intermediate" "$maps"
mkdir -p "$assets" "$resources" "$intermediate" "$maps"
bundle="$assets/index.android.bundle"

cd "$app"
cli="$(node --print "require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] })")"
entry="$(node -e "require('expo/scripts/resolveAppEntry')" "$app" android absolute)"
hermes="$(dirname "$(node --print "require.resolve('hermes-compiler/package.json', { paths: [require.resolve('react-native/package.json')] })")")"
mapfile -t flags < <(node "$here/repack.ts" hermes-flags android/app/build.gradle)

start=$SECONDS
node "$cli" export:embed --platform android --dev false --reset-cache \
  --entry-file "$entry" --bundle-output "$bundle" --assets-dest "$resources" \
  --sourcemap-output "$intermediate/index.android.bundle.packager.map" --minify false --verbose
echo "Metro: $((SECONDS - start)) s"

start=$SECONDS
"$hermes/hermesc/linux64-bin/hermesc" -w -emit-binary -max-diagnostic-width=80 \
  -out "$intermediate/index.android.bundle.hbc" "$bundle" "${flags[@]}"
mv "$intermediate/index.android.bundle.hbc" "$bundle"
if printf '%s\n' "${flags[@]}" | grep -qx -- '-output-source-map'; then
  mv "$intermediate/index.android.bundle.hbc.map" "$intermediate/index.android.bundle.compiler.map"
  rn="$(dirname "$(node --print "require.resolve('react-native/package.json')")")"
  node "$rn/scripts/compose-source-maps.js" "$intermediate/index.android.bundle.packager.map" \
    "$intermediate/index.android.bundle.compiler.map" -o "$maps/index.android.bundle.map"
fi
echo "hermesc ${flags[*]}: $((SECONDS - start)) s"

# Written last, so a failed export/compiler can never authorize Gradle's handoff.
node --input-type=module - "$manifest" "$assets" "$resources" "$here/repack.ts" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [manifest, assets, resources, module] = process.argv.slice(2);
const { assetManifest, hermesFlags } = await import(pathToFileURL(module));
writeFileSync(manifest, JSON.stringify({
  assetsDir: assets, resourcesDir: resources,
  assets: assetManifest(assets), resources: assetManifest(resources),
  hermesFlags: hermesFlags(readFileSync('android/app/build.gradle', 'utf8')),
}));
NODE
