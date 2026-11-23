#!/usr/bin/env bash
# Follow docs/INSTALL-MAC.md as far as a machine with no person at it can: open the dmg, copy the app to Applications,
# mark it as downloaded (the quarantine flag a browser sets), clear the flag the way the doc says, start the app, check
# it stays up, open a parachute:// link, and take screenshots.
#   scripts/mac-smoke.sh <Parachute.dmg> [<folder for screenshots and notes>]
set -euo pipefail
# it replaces /Applications/Parachute.app: CI only, or say so
[ "${CI:-}" = true ] || [ "${PARACHUTE_MAC_DRIVE:-}" = yes ] || { echo "This replaces /Applications/Parachute.app. On a machine of your own, set PARACHUTE_MAC_DRIVE=yes." >&2; exit 2; }
dmg=$1 out=${2:-mac-smoke}
mkdir -p "$out"
say() { echo "== $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

mnt=$(mktemp -d)
hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mnt" >/dev/null
trap 'hdiutil detach "$mnt" -quiet || true' EXIT
say "the dmg holds:"; ls -la "$mnt"
[ -d "$mnt/Parachute.app" ] || fail "no Parachute.app in the dmg"
[ -L "$mnt/Applications" ] || fail "no Applications shortcut in the dmg"

say "drag to Applications"
app=/Applications/Parachute.app
rm -rf "$app"
cp -R "$mnt/Parachute.app" /Applications/
xattr -w com.apple.quarantine "0081;$(printf %x "$(date +%s)");Safari;" "$app"

say "signature"
codesign -dvv "$app" 2>&1 | tee "$out/codesign.txt"  # -vv: the Authority lines too
codesign --verify --deep --strict "$app" || fail "signature doesn't verify"
if [ -n "${PARACHUTE_MAC_SIGNED:-}" ]; then
  # signed and notarised (mac.yml): Gatekeeper takes the downloaded app as it is
  grep -q "Authority=Developer ID Application" "$out/codesign.txt" || fail "not signed with a Developer ID certificate"
  say "Gatekeeper (must accept: notarised)"
  spctl -a -vv "$app" > "$out/gatekeeper.txt" 2>&1 || { cat "$out/gatekeeper.txt"; fail "Gatekeeper refuses the downloaded app"; }
  cat "$out/gatekeeper.txt"
  grep -q "source=Notarized Developer ID" "$out/gatekeeper.txt" || fail "Gatekeeper accepts it, but not as notarised"
  # macOS still asks once whether to open an app from the internet; the person's Open clears this flag
  say "Open, as the person answers macOS's one question"
else
  grep -q "Signature=adhoc" "$out/codesign.txt" || fail "not ad-hoc signed"
  say "Gatekeeper (expected to refuse: not notarised)"
  spctl -a -vv "$app" 2>&1 | tee "$out/gatekeeper.txt" || true
  say "past Gatekeeper, as docs/INSTALL-MAC.md says"
fi
xattr -dr com.apple.quarantine "$app"
if xattr -p com.apple.quarantine "$app" >/dev/null 2>&1; then fail "quarantine flag still set"; fi

exe=$(defaults read "$app/Contents/Info" CFBundleExecutable)
say "start ($exe)"
open "$app"
up() { pgrep -x "$exe" >/dev/null; }
for _ in $(seq 30); do up && break; sleep 1; done
up || fail "the app didn't start"
sleep 15
up || fail "the app quit after starting"
screencapture -x "$out/01-first-run.png" || echo "no screenshot (no screen?)"
# what the window shows, read through accessibility where the runner allows it
osascript -e 'tell application "System Events" to tell process "'"$exe"'" to get {name, value, description} of entire contents of window 1' \
  > "$out/01-first-run-ui.txt" 2>&1 || echo "accessibility not available here" >> "$out/01-first-run-ui.txt"

say "a parachute:// link"
open "parachute://open?url=https%3A%2F%2Fexample.com%2F"
sleep 5
up || fail "the app quit on a parachute:// link"
screencapture -x "$out/02-link.png" || true

pkill -x "$exe" || true
say "ok: installed from the dmg, past Gatekeeper${PARACHUTE_MAC_SIGNED:+ (notarised)}, started, stayed up, took a link"
