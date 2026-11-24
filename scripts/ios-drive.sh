#!/usr/bin/env bash
# The iPhone app on a simulator, driven as a person would (scripts/ios-drive/Drive/Drive.swift, an XCUITest): a fresh
# simulator of its own, the app installed, the e2e hub and the fake Buzz relay on loopback (e2e/ios/world.ts; the
# simulator shares the Mac's loopback), then paste a key, sign in, open Rooms, allow it with Face ID (enrolled here, and
# matched while the drive runs: the simulator has no face), see the room. Screenshots and the test's result go to the
# folder. Needs Xcode, xcodegen, node and PARACHUTE_CORE (a parachute-core binary).
#   scripts/ios-drive.sh <Parachute.app built for the simulator> [<folder>]
set -euo pipefail
app=${1:?the .app built for the simulator}
out=$(mkdir -p "${2:-ios-drive}" && cd "${2:-ios-drive}" && pwd)
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
: "${PARACHUTE_CORE:?set PARACHUTE_CORE to a parachute-core binary}"
say() { echo "== $*"; }

say "a simulator of its own"
runtime=$(xcrun simctl list runtimes -j | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")).runtimes.filter(x=>x.isAvailable&&x.platform==="iOS").sort((a,b)=>a.version.localeCompare(b.version,undefined,{numeric:true}));const t=r.at(-1);if(!t)process.exit(1);const d=t.supportedDeviceTypes.filter(x=>/^iPhone \d+( Pro)?$/.test(x.name)).at(-1)??t.supportedDeviceTypes.find(x=>x.productFamily==="iPhone");console.log(t.identifier,d.identifier)')
read -r rt dt <<<"$runtime"
udid=$(xcrun simctl create "ios-t520-drive-$$" "$dt" "$rt")
world=$(mktemp -d)
worldpid=""; matchpid=""; logpid=""
cleanup() {
  [ -n "$matchpid" ] && kill "$matchpid" 2>/dev/null || true
  [ -n "$logpid" ] && kill "$logpid" 2>/dev/null || true
  [ -n "$worldpid" ] && kill "$worldpid" 2>/dev/null && wait "$worldpid" 2>/dev/null || true
  xcrun simctl io "$udid" screenshot "$out/last.png" >/dev/null 2>&1 || true
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  xcrun simctl delete "$udid" >/dev/null 2>&1 || true
  rm -rf "$world"
}
trap cleanup EXIT
echo "$dt on $rt: $udid"
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b >/dev/null
# Face ID enrolled, as on a phone that has it (the unlock before Allow: src-tauri/src/keyring.rs)
xcrun simctl spawn "$udid" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
xcrun simctl spawn "$udid" notifyutil -p com.apple.BiometricKit.enrollmentChanged

# the app's own log and WebKit's, for when a step fails (app.log beside the screenshots)
xcrun simctl spawn "$udid" log stream --level debug --style compact \
  --predicate 'process == "parachute" OR process == "Parachute" OR process CONTAINS "WebContent" OR process CONTAINS "Networking"' > "$out/app.log" 2>&1 &
logpid=$!

say "install the app"
xcrun simctl install "$udid" "$app"
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$app/Info.plist"

say "the hub, the relay, Rooms in the home vault"
(cd "$root" && exec npx vite-node e2e/ios/world.ts "$world/world.json") > "$out/world.log" 2>&1 &
worldpid=$!
for _ in $(seq 240); do [ -s "$world/world.json" ] && break; kill -0 "$worldpid" 2>/dev/null || break; sleep 0.5; done
[ -s "$world/world.json" ] || { cat "$out/world.log"; echo "FAIL: the hub and relay didn't start" >&2; exit 1; }
field() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]])' "$world/world.json" "$1"; }
grep '^world:' "$out/world.log"

say "the drive"
(cd "$here/ios-drive" && xcodegen generate --quiet)
# a matching face whenever Face ID asks during the drive (a match with no question open does nothing)
(while sleep 1; do xcrun simctl spawn "$udid" notifyutil -p com.apple.BiometricKit_Sim.pearl.match >/dev/null 2>&1 || true; done) &
matchpid=$!
# TEST_RUNNER_X reaches the test as X; the key is this run's throwaway
TEST_RUNNER_PARACHUTE_HUB=$(field hub) TEST_RUNNER_PARACHUTE_KEY=$(field key) TEST_RUNNER_PARACHUTE_ROOM=$(field room) \
TEST_RUNNER_PARACHUTE_SHOTS="$out" \
  xcodebuild test -project "$here/ios-drive/ParachuteDrive.xcodeproj" -scheme Drive -destination "id=$udid" \
  -resultBundlePath "$out/drive.xcresult" CODE_SIGNING_ALLOWED=NO 2>&1 | tee "$out/drive.log" | grep -E "Test Case|error:|failed|passed|\*\*" || true
grep -q "\*\* TEST SUCCEEDED \*\*" "$out/drive.log" || { echo "FAIL: the drive failed (its log and screenshots: $out)" >&2; exit 1; }
say "ok: signed in with a pasted key, the hub's Approve, the applets, Rooms allowed with Face ID, the room on the relay"
