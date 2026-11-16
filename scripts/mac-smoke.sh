#!/usr/bin/env bash
# Follow docs/INSTALL-MAC.md as far as a machine with no person at it can: open the dmg, copy the app to Applications,
# mark it as downloaded (the quarantine flag a browser sets), clear the flag the way the doc says, start the app, check
# it stays up, open a parachute:// link, and take screenshots.
#   scripts/mac-smoke.sh <Parachute.dmg> [<folder for screenshots and notes>]
set -euo pipefail
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
codesign -dv "$app" 2>&1 | tee "$out/codesign.txt"
grep -q "Signature=adhoc" "$out/codesign.txt" || fail "not ad-hoc signed"
codesign --verify --deep --strict "$app" || fail "signature doesn't verify"
say "Gatekeeper (expected to refuse: not notarised)"
spctl -a -vv "$app" 2>&1 | tee "$out/gatekeeper.txt" || true

say "past Gatekeeper, as docs/INSTALL-MAC.md says"
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
say "ok: installed from the dmg, past Gatekeeper, started, stayed up, took a link"
