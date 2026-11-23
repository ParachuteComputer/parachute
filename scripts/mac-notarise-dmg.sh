#!/usr/bin/env bash
# Notarise and staple the dmg (Tauri notarises and staples only the app inside it), then check both as Gatekeeper sees a
# download: the app signed with a Developer ID certificate and the hardened runtime, each with its ticket stapled.
#   scripts/mac-notarise-dmg.sh <Parachute.dmg> <Parachute.app>
# Needs APPLE_API_KEY (the App Store Connect key's id), APPLE_API_ISSUER and APPLE_API_KEY_PATH (its .p8). docs/STORES.md
set -euo pipefail
dmg=$1 app=$2
: "${APPLE_API_KEY:?}" "${APPLE_API_ISSUER:?}" "${APPLE_API_KEY_PATH:?}"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== the app"
codesign --verify --deep --strict "$app" || fail "the app's signature doesn't verify"
sig=$(codesign -dv --verbose=4 "$app" 2>&1)
grep -q "Authority=Developer ID Application" <<<"$sig" || fail "the app isn't signed with a Developer ID certificate"
grep -Eq "flags=.*runtime" <<<"$sig" || fail "the app isn't signed with the hardened runtime"
xcrun stapler validate "$app" || fail "the app has no notarisation ticket stapled"

echo "== notarise the dmg"
codesign -dv "$dmg" 2>&1 | grep -q "Authority=Developer ID Application" || fail "the dmg isn't signed with the Developer ID certificate"
result=$(xcrun notarytool submit "$dmg" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" \
  --wait --timeout 45m --output-format json)
id=$(node -p 'JSON.parse(process.argv[1]).id' "$result") status=$(node -p 'JSON.parse(process.argv[1]).status' "$result")
echo "submission $id: $status"
if [ "$status" != Accepted ]; then
  xcrun notarytool log "$id" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" || true
  fail "Apple didn't accept the dmg ($status)"
fi
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg" || fail "the dmg's ticket didn't staple"

echo "== as Gatekeeper sees them"
spctl -a -vv -t install "$app" 2>&1 | tee /dev/stderr | grep -q "source=Notarized Developer ID" || fail "Gatekeeper doesn't take the app as notarised"
spctl -a -vv -t open --context context:primary-signature "$dmg" 2>&1 | tee /dev/stderr | grep -q "source=Notarized Developer ID" \
  || fail "Gatekeeper doesn't take the dmg as notarised"
echo "ok: the app and the dmg are signed, notarised and stapled"
