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
grep -q "^Timestamp=" <<<"$sig" || fail "the app's signature has no secure timestamp (notarisation refuses it)"
xcrun stapler validate "$app" || fail "the app has no notarisation ticket stapled"

echo "== notarise the dmg"
dsig=$(codesign -dv --verbose=4 "$dmg" 2>&1)
grep -q "Authority=Developer ID Application" <<<"$dsig" || fail "the dmg isn't signed with the Developer ID certificate"
grep -q "^Timestamp=" <<<"$dsig" || fail "the dmg's signature has no secure timestamp"
# notarytool exits non-zero on a refusal or a timeout; its answer is read either way, so the log below can say why
result=$(xcrun notarytool submit "$dmg" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" \
  --wait --timeout 40m --output-format json) || true
read -r id status < <(node -e 'try { const r = JSON.parse(process.argv[1]); console.log(r.id || "-", r.status || "none") } catch { console.log("- none") }' "$result")
echo "submission $id: $status"
if [ "$status" != Accepted ]; then
  [ "$id" = - ] && echo "$result" >&2
  [ "$id" = - ] || xcrun notarytool log "$id" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" || true
  fail "Apple didn't accept the dmg ($status)"
fi
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg" || fail "the dmg's ticket didn't staple"

echo "== as Gatekeeper sees them"
gk=$(spctl -a -vv -t exec "$app" 2>&1) || { echo "$gk" >&2; fail "Gatekeeper refuses the app"; }
echo "$gk"; grep -q "source=Notarized Developer ID" <<<"$gk" || fail "Gatekeeper doesn't take the app as notarised"
gk=$(spctl -a -vv -t open --context context:primary-signature "$dmg" 2>&1) || { echo "$gk" >&2; fail "Gatekeeper refuses the dmg"; }
echo "$gk"; grep -q "source=Notarized Developer ID" <<<"$gk" || fail "Gatekeeper doesn't take the dmg as notarised"
echo "ok: the app and the dmg are signed, notarised and stapled"
