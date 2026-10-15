#!/usr/bin/env bash
# ccache in front of the NDK's compilers, for the CMake builds of the app and its
# native libraries. CMake 3.17+ reads CMAKE_<LANG>_COMPILER_LAUNCHER from the
# environment, so no library's build files change. Its settings (CCACHE_*) are
# in the job's env in ci.yml.
#   scripts/ci/ccache.sh setup   install ccache and start this build's statistics from zero
#   scripts/ci/ccache.sh stats   print this build's statistics
set -euo pipefail

case "${1:-}" in
  setup)
    if ! command -v ccache > /dev/null; then
      sudo apt-get update -qq
      sudo apt-get install -y -qq --no-install-recommends ccache > /dev/null
    fi
    ccache --version | head -n 1
    # The restored directory carries the statistics of the build that saved it.
    ccache --zero-stats > /dev/null
    {
      echo "CMAKE_C_COMPILER_LAUNCHER=ccache"
      echo "CMAKE_CXX_COMPILER_LAUNCHER=ccache"
    } >> "${GITHUB_ENV:?}"
    ccache --show-config | grep -E '^\((environment|.*ccache.conf)\)' || true
    ;;
  stats)
    ccache --show-stats --verbose
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      {
        echo "#### ccache"
        echo
        echo '```text'
        ccache --show-stats
        echo '```'
      } >> "$GITHUB_STEP_SUMMARY"
    fi
    ;;
  *)
    echo "usage: $0 setup|stats" >&2
    exit 2
    ;;
esac
