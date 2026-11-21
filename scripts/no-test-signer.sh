#!/usr/bin/env bash
# The app's bundle must not hold the end-to-end tests' signer (src/services/e2eNative.ts): it is compiled in only when a
# build sets VITE_E2E_SIGNER=1. Run on the dist/ the app is built from (CI, and the Mac build after `tauri build`).
set -euo pipefail
dist="${1:-dist}"
[ -d "$dist" ] || { echo "no $dist to check"; exit 1; }
if grep -rlE "__parachuteE2EKey|parachute-e2e-test-signer|e2eNative|bcf193dfc16ce72d537863fd04861c5abf18a304da35d1a6e7dfb865e9364904" "$dist"; then
  echo "the test signer is in $dist: build without VITE_E2E_SIGNER" >&2
  exit 1
fi
echo "no test signer in $dist"
