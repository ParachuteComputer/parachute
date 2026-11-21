#!/usr/bin/env bash
# Sign in on the Mac app as a person would, driven through accessibility (scripts/mac-ax.swift): paste a secret key,
# check it went into the login Keychain, add a throwaway hub on loopback (two vaults) as the person's Parachute and sign
# in to it with the key (the shell lists the key's vaults, the hub's key door, one consent page, back into the app with
# both vaults: docs/design/ONE-SIGN-IN.md); then remove it and make a new key; then remove that and pair a
# key in from a stand-in for the Uni app (examples/pair_send.rs), pasting its link. Run after scripts/mac-smoke.sh
# installed the app. Needs PARACHUTE_CORE (a parachute-core binary), PAIR_SEND (the built pair_send example) and node.
#   scripts/mac-signin.sh [<folder for screenshots>]
set -euo pipefail
# it replaces /Applications/Parachute.app's key in the login Keychain with throwaway ones: CI only, or say so
[ "${CI:-}" = true ] || [ "${PARACHUTE_MAC_DRIVE:-}" = yes ] || { echo "This removes the Parachute key in your Keychain. On a machine of your own, set PARACHUTE_MAC_DRIVE=yes." >&2; exit 2; }
out=${1:-mac-smoke}
mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
app=/Applications/Parachute.app
exe=$(defaults read "$app/Contents/Info" CFBundleExecutable)
say() { echo "== $*"; }
fail() { echo "FAIL: $*" >&2; ax dump > "$out/failed-ui.txt" 2>&1 || true; screencapture -x "$out/failed.png" || true; exit 1; }
ax() { "$axbin" "$exe" "$@"; }
shot() { sleep 1; screencapture -x "$out/$1.png" || true; }
: "${PARACHUTE_CORE:?set PARACHUTE_CORE to a parachute-core binary}"
: "${PAIR_SEND:?set PAIR_SEND to the built pair_send example (cargo build --example pair_send)}"
keychain() { security find-generic-password -s computer.parachute.app -a nostr-key > /dev/null 2>&1; }
remove_key() {
  ax press "Settings" || fail "no Settings"
  ax press "Remove from this device" || fail "no Remove from this device"
  ax press "Remove" || fail "no Remove"
  ax wait "Add your key" 10 || fail "the key wasn't removed"
  if keychain; then fail "the key is still in the Keychain after Remove"; fi
  echo "removed: no longer in the Keychain"
}

say "build the accessibility driver"
axbin="${RUNNER_TEMP:-$(mktemp -d)}/mac-ax"
swiftc -O -o "$axbin" "$here/mac-ax.swift"

say "a throwaway hub on loopback"
hub=$(mktemp -d)
printf 'correct horse battery staple 1' > "$hub/pw"
export PARACHUTE_HOME="$hub/home"
"$PARACHUTE_CORE" bootstrap --embedded --home "$PARACHUTE_HOME" --username owner --password-file "$hub/pw" --vault recipes --json > /dev/null
# two free ports at once (both held until both are known, so they differ)
read -r port vport < <(node -e 'const n=require("net");const a=n.createServer().listen(0,"127.0.0.1",()=>{const b=n.createServer().listen(0,"127.0.0.1",()=>{console.log(a.address().port,b.address().port);a.close();b.close()})})')
PARACHUTE_HUB_ORIGIN="http://127.0.0.1:$port" "$PARACHUTE_CORE" serve --embedded --home "$PARACHUTE_HOME" \
  --listen "127.0.0.1:$port" --vault-listen "127.0.0.1:$vport" > "$hub/serve.log" 2>&1 &
hubpid=$!
trap 'kill $hubpid 2>/dev/null || true; rm -rf "$hub"' EXIT
for _ in $(seq 120); do grep -q "ready: hub" "$hub/serve.log" && break; sleep 0.25; done
grep -q "ready: hub" "$hub/serve.log" || { cat "$hub/serve.log"; fail "the hub didn't start"; }
# a second vault: one sign-in brings both
PORT=$port "$PARACHUTE_CORE" vault create work --json --no-mirror > /dev/null

say "a throwaway key, linked to the hub's owner"
# a Nostr key is a secp256k1 secret; its public key is the point's x coordinate (the secret never leaves this shell)
read -r sk pk < <(node -e 'const e=require("crypto").createECDH("secp256k1");e.generateKeys();console.log(e.getPrivateKey("hex").padStart(64,"0"),e.getPublicKey("hex","compressed").slice(2))')
PORT=$port "$PARACHUTE_CORE" auth link-pubkey --user owner "$pk" > /dev/null

say "the app, fresh"
pkill -x "$exe" 2>/dev/null || true
security delete-generic-password -s computer.parachute.app -a nostr-key >/dev/null 2>&1 || true
open "$app"
ax wait "Make a new key" 30 || fail "the first screen didn't show"
shot 10-key-start

say "paste a secret key"
ax press "Advanced: paste a secret key" || fail "no paste-a-key section"
ax type "nsec1…" "$sk" || fail "no secret key field"
ax press "Keep this key" || fail "no Keep this key"
# a kept key goes straight on to signing in to a Parachute
ax wait "Sign in with your key" 20 || fail "the key wasn't kept"
keychain || fail "the key isn't in the login Keychain"
echo "the key is in the login Keychain (computer.parachute.app / nostr-key)"

say "sign in to the Parachute with the key: one Approve, to read the home"
ax type "Your Parachute's address" "http://127.0.0.1:$port" || fail "no Parachute address field"
# Add a Parachute asks whose it is, every time (docs/OTHER-PARACHUTES.md)
ax press "Mine" || fail "no Mine on Add a Parachute"
shot 12-add-parachute
ax press "Sign in with your key" || fail "no Sign in with your key"
# the key is the hub owner's: it reaches every vault, so the app asks which are theirs (all ticked) and which is home
# (the first by name) before the consent (docs/design/SCOPES.md)
ax wait "Which vaults on 127.0.0.1:$port are yours?" 30 || fail "no pick of the person's own vaults"
shot 12b-pick
ax press "Continue" || fail "no Continue on the pick"
ax wait "Approve Parachute?" 30 || fail "the hub's Approve page didn't open"
shot 13-hub-consent
ax press "Approve" || fail "no Approve on the hub's page"
# the list of the app's applets (Parachute's own first: docs/design/PARACHUTE-SOURCE.md); in Settings, the home (recipes,
# the first by name, chosen on the pick) to open, and the other vault a line to open (the sign-in read the home only)
ax wait "connect your AI" 40 || fail "the list of applets didn't open"
sleep 2
shot 14-list
ax press "Settings" || fail "no Settings on the list"
ax wait "Open recipes" 20 || fail "the home isn't in Settings"
ax wait "Open work" 20 || fail "the other vault isn't offered to open"
shot 14b-settings-vaults
ax dump > "$out/14-settings-ui.txt" 2>&1 || true
ax press "Back" || fail "no Back from Settings"

say "remove the key, make a new one"
remove_key
ax press "Add your key" || fail "no Add your key"
ax press "Make a new key" || fail "no Make a new key"
ax wait "Continue" 20 || fail "no new key"
keychain || fail "the new key isn't in the login Keychain"
echo "the new key is in the login Keychain"
shot 15-new-key
ax press "Continue" || fail "no Continue"

say "remove it, pair a key from another device by pasting its link"
remove_key
"$PAIR_SEND" > "$hub/pair.log" 2>&1 &
sendpid=$!
trap 'kill $hubpid $sendpid 2>/dev/null || true; rm -rf "$hub"' EXIT
line() { awk -v k="$1" '$1 == k { sub(/^[^ ]+ /, ""); print; exit }' "$hub/pair.log"; }
for _ in $(seq 40); do [ -n "$(line link)" ] && break; sleep 0.25; done
link=$(line link)
[ -n "$link" ] || { cat "$hub/pair.log"; fail "the sender gave no link"; }
ax press "Add your key" || fail "no Add your key"
ax press "Pair from a device that has your key" || fail "no Pair from a device"
ax type "Pairing link" "$link" || fail "no Pairing link field"
ax press "Start" || fail "no Start"
for _ in $(seq 80); do [ -n "$(line sas)" ] && break; sleep 0.25; done
sas=$(line sas)
[ -n "$sas" ] || { cat "$hub/pair.log"; fail "the app never answered the sender"; }
# the code as the screen reads it out ("Code 1 2 3 4 5 6")
ax wait "Code $(echo "$sas" | sed 's/./& /g; s/ $//')" 20 || fail "the app doesn't show the sender's code $sas"
echo "both show $sas"
shot 16-pair-code
ax press "The codes match" || fail "no The codes match"
for _ in $(seq 120); do grep -qx done "$hub/pair.log" && break; sleep 0.25; done
grep -qx done "$hub/pair.log" || { cat "$hub/pair.log"; fail "the app didn't say it kept the key"; }
keychain || fail "the paired key isn't in the login Keychain"
ax press "Settings" || fail "no Settings"
ax wait "$(line npub)" 10 || fail "Settings doesn't show the paired key"
echo "paired: the sender's key is the app's key, in the Keychain"
shot 17-paired-key

pkill -x "$exe" || true
say "ok: pasted, new and paired keys each kept in the Keychain and removed; signed in to a Parachute with a key; both vaults in Settings"
