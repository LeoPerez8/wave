#!/usr/bin/env bash
# Builds the two perf APKs the React Compiler comparison runs (#728, #1355): the same commit
# with the compiler off and on, for arm64 phones, or for an x86_64 emulator (#1433).
# See docs/performance/728-react-compiler.md.
#   scripts/perf/react-compiler-apks.sh [x86_64]
# Leaves perf-results/apks/wave-<commit>-compiler-off.apk and -compiler-on.apk (with -x86_64
# before .apk for the emulator).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
root="$PWD"
commit="$(git rev-parse --short HEAD)"
out="$root/perf-results/apks"
abi="${1:-arm64-v8a}"
suffix=""
[ "$abi" = arm64-v8a ] || suffix="-$abi"
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
    ./gradlew assembleRelease -PreactNativeArchitectures="$abi" --console=plain
  cp app/build/outputs/apk/release/app-release.apk "$out/wave-$commit-compiler-$name$suffix.apk"
  echo "Built $out/wave-$commit-compiler-$name$suffix.apk"
}

build off EXPO_PUBLIC_WAVE_REACT_COMPILER=0
build on EXPO_PUBLIC_WAVE_REACT_COMPILER=1
