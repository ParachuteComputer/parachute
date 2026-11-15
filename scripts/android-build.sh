#!/usr/bin/env bash
# Build the Android app, signed with the play-test key, and check the signature.
#   scripts/android-build.sh [--debug] [--target aarch64|x86_64]   (default: release, aarch64)
# Needs ANDROID_HOME, NDK_HOME, Java 17, and the key at ~/.config/parachute-playtest/keystore.properties (or
# PARACHUTE_KEYSTORE_PROPERTIES). Gradle's own debug key is kept in a folder of the play-test's, never another app's.
set -euo pipefail
cd "$(dirname "$0")/.."
mode=release target=aarch64
while [ $# -gt 0 ]; do case "$1" in --debug) mode=debug ;; --target) target=$2; shift ;; *) echo "unknown: $1" >&2; exit 2 ;; esac; shift; done
props=${PARACHUTE_KEYSTORE_PROPERTIES:-$HOME/.config/parachute-playtest/keystore.properties}
[ -f "$props" ] || { echo "no play-test key at $props" >&2; exit 1; }
export ANDROID_USER_HOME="${PARACHUTE_ANDROID_USER_HOME:-$(dirname "$props")/android-home}"
mkdir -p "$ANDROID_USER_HOME"
flags=(--apk --target "$target"); [ "$mode" = debug ] && flags+=(--debug)
npx tauri android build "${flags[@]}"
apk=$(ls -t src-tauri/gen/android/app/build/outputs/apk/*/"$mode"/*.apk | head -1)
bt=$(command ls -1 "$ANDROID_HOME/build-tools" | sort -V | tail -1)
# the password goes to keytool through its environment, never on a command line
want=$(KEYPASS="$(sed -n 's/^storePassword=//p' "$props")" keytool -list -v -keystore "$(sed -n 's/^storeFile=//p' "$props")" -alias "$(sed -n 's/^keyAlias=//p' "$props")" -storepass:env KEYPASS 2>/dev/null | sed -n 's/.*SHA256: //p' | head -1 | tr -d ':' | tr 'A-F' 'a-f')
got=$("$ANDROID_HOME/build-tools/$bt/apksigner" verify --print-certs "$apk" | sed -n 's/.*SHA-256 digest: //p' | head -1)
[ -n "$want" ] && [ "$got" = "$want" ] || { echo "$apk is not signed with the play-test key (got ${got:-none})" >&2; exit 1; }
echo "$apk"
echo "signed with the play-test key ${got:0:16}…"
