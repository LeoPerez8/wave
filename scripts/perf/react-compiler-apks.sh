#!/usr/bin/env bash
# Builds the two perf APKs the React Compiler comparison runs (#728, #1355): the same commit
# with the compiler off and on, for arm64 phones. See docs/performance/728-react-compiler.md.
#   scripts/perf/react-compiler-apks.sh
# Leaves perf-results/apks/wave-<commit>-compiler-off.apk and -compiler-on.apk.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
root="$PWD"
commit="$(git rev-parse --short HEAD)"
out="$root/perf-results/apks"
mkdir -p "$out"
pnpm install -s --frozen-lockfile --prefer-offline
cd apps/mobile
EXPO_NO_GIT_STATUS=1 pnpm exec expo prebuild --platform android --no-install
cd android

build() {
  local name="$1"
  shift
  # Gradle doesn't see a changed bundle variable: drop the last bundle so each build makes its own.
  rm -rf app/build/generated/assets/react "${TMPDIR:-/tmp}/metro-cache"
  env "$@" EXPO_PUBLIC_WAVE_PERF=1 EXPO_PUBLIC_WAVE_COMMIT="$commit" \
    ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
  cp app/build/outputs/apk/release/app-release.apk "$out/wave-$commit-compiler-$name.apk"
  echo "Built $out/wave-$commit-compiler-$name.apk"
}

build off EXPO_PUBLIC_WAVE_REACT_COMPILER=0
build on EXPO_PUBLIC_WAVE_REACT_COMPILER=1
