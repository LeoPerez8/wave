#!/usr/bin/env bash
# Builds this checkout as a release APK for an x86_64 emulator and installs it. CI's APKs
# ship only arm64-v8a and crash on launch there. See docs/agents/emulator-checks.md.
#   scripts/emulator-apk.sh [adb-serial]
# The APK is left at apps/mobile/android/app/build/outputs/apk/release/app-release.apk.
set -euo pipefail

serial="${1:-}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
needed_gb=12
free_gb="$(df -BG --output=avail . | tail -1 | tr -dc 0-9)"
if [ "$free_gb" -lt "$needed_gb" ]; then
  echo "Only $free_gb GB free; a build needs about $needed_gb GB. Try scripts/clean-worktrees.sh." >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"
pnpm install -s --frozen-lockfile --prefer-offline
cd apps/mobile
EXPO_NO_GIT_STATUS=1 pnpm exec expo prebuild --platform android --no-install
cd android
./gradlew assembleRelease -PreactNativeArchitectures=x86_64 --console=plain

apk="$PWD/app/build/outputs/apk/release/app-release.apk"
case "$(unzip -l "$apk")" in
  *lib/x86_64/*) ;;
  *)
    echo "$apk has no x86_64 libraries." >&2
    exit 1
    ;;
esac
echo "Built $apk"
if [ -n "$serial" ]; then
  adb -s "$serial" install -r "$apk"
fi
