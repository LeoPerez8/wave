#!/usr/bin/env bash
# Builds what a release publishes over the air, in the shape apps/updates/scripts/publish.ts
# reads: `expo export`'s bundle and assets, and the app config phones read under the update.
# It inlines the same EXPO_PUBLIC_* values as bundle.sh, from the job's env.
#   scripts/ci/export-update.sh <output dir>
# Run it from the repo root, after install.
set -euo pipefail

output="$(realpath -m "$1")"
cd apps/mobile
pnpm exec expo export --platform android --output-dir "$output"
pnpm exec expo config --type public --json > "$output/expo-config.json"
