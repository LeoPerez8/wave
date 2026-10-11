#!/usr/bin/env bash
# Pins the SDK-bound mobile dependencies to the versions the installed Expo SDK
# expects. Run by CI when the lockfile is missing (agent sessions can't reach the
# npm registry); the resulting package.json and lockfile are committed back.
set -euo pipefail

pnpm install --no-frozen-lockfile

cd apps/mobile
pnpm exec expo install \
  expo-router expo-linking expo-constants expo-status-bar expo-font expo-splash-screen \
  expo-system-ui expo-build-properties \
  react react-native react-native-screens react-native-safe-area-context \
  react-native-reanimated react-native-worklets react-native-gesture-handler react-native-svg
pnpm exec expo install @types/react -- --save-dev
pnpm exec expo install --fix
