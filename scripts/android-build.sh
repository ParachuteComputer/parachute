#!/usr/bin/env bash
# Build the Android app, signed, and check the signature.
#   scripts/android-build.sh [--debug] [--target aarch64|x86_64]   (default: release, aarch64): the APK people install
#     themselves, signed with the play-test key
#   scripts/android-build.sh --play [--target aarch64|x86_64]: the app bundle (.aab) for Google Play, signed with the
#     upload key, with no in-app update: no right to install apps, no update feed (docs/STORES.md)
# PARACHUTE_UPDATE_FEED=<https://…/latest.json> makes an APK that looks there for newer ones (src-tauri/src/updates.rs).
# Needs ANDROID_HOME, NDK_HOME, Java 17, and the key: the play-test key at ~/.config/parachute-playtest/keystore.properties,
# the upload key at ~/.config/parachute-play-upload/keystore.properties (or PARACHUTE_KEYSTORE_PROPERTIES for either).
# Gradle's own debug key is kept in a folder of the key's, never another app's.
set -euo pipefail
cd "$(dirname "$0")/.."
mode=release target=aarch64 play=
while [ $# -gt 0 ]; do case "$1" in --debug) mode=debug ;; --play) play=1 ;; --target) target=$2; shift ;; *) echo "unknown: $1" >&2; exit 2 ;; esac; shift; done
if [ -n "$play" ]; then
  [ "$mode" = release ] || { echo "--play is a release build" >&2; exit 2; }
  [ -z "${PARACHUTE_UPDATE_FEED:-}" ] || { echo "--play: Play updates the app, so its build has no update feed: unset PARACHUTE_UPDATE_FEED" >&2; exit 2; }
  export PARACHUTE_STORE=play
  keyname="upload key"
  props=${PARACHUTE_KEYSTORE_PROPERTIES:-$HOME/.config/parachute-play-upload/keystore.properties}
else
  unset PARACHUTE_STORE
  keyname="play-test key"
  props=${PARACHUTE_KEYSTORE_PROPERTIES:-$HOME/.config/parachute-playtest/keystore.properties}
fi
[ -f "$props" ] || { echo "no $keyname at $props" >&2; exit 1; }
export PARACHUTE_KEYSTORE_PROPERTIES=$props
export ANDROID_USER_HOME="${PARACHUTE_ANDROID_USER_HOME:-$(dirname "$props")/android-home}"
mkdir -p "$ANDROID_USER_HOME"
# which build this is (src/shell/updates.ts): the commit and its time, the same for the screens (vite.config.ts) and the
# version code, which then only grows along next, so Android takes each newer build as an update of the one before
export PARACHUTE_BUILD_AT=${PARACHUTE_BUILD_AT:-$(git log -1 --format=%ct)} PARACHUTE_BUILD_COMMIT=${PARACHUTE_BUILD_COMMIT:-$(git rev-parse --short=7 HEAD)}
[[ $PARACHUTE_BUILD_AT =~ ^[0-9]+$ && -n $PARACHUTE_BUILD_COMMIT ]] || { echo "no build identity (git, or PARACHUTE_BUILD_AT and PARACHUTE_BUILD_COMMIT)" >&2; exit 1; }
flags=(--target "$target" --config "{\"bundle\":{\"android\":{\"versionCode\":$PARACHUTE_BUILD_AT}}}")
if [ -n "$play" ]; then flags+=(--aab); else flags+=(--apk); fi
[ "$mode" = debug ] && flags+=(--debug)
npx tauri android build "${flags[@]}"
# the bundle the app was built from has no test signer (src/services/e2eNative.ts)
scripts/no-test-signer.sh dist >&2
# the password goes to keytool through its environment, never on a command line
want=$(KEYPASS="$(sed -n 's/^storePassword=//p' "$props")" keytool -list -v -keystore "$(sed -n 's/^storeFile=//p' "$props")" -alias "$(sed -n 's/^keyAlias=//p' "$props")" -storepass:env KEYPASS 2>/dev/null | sed -n 's/.*SHA256: //p' | head -1 | tr -d ':' | tr 'A-F' 'a-f')
if [ -n "$play" ]; then
  out=$(ls -t src-tauri/gen/android/app/build/outputs/bundle/*Release/*.aab | head -1)
  # a bundle is signed as a jar: its certificate, then what Play reads from its manifest (stored as protobuf, whose
  # strings are plain text)
  got=$(keytool -printcert -jarfile "$out" | sed -n 's/.*SHA256: //p' | head -1 | tr -d ':' | tr 'A-F' 'a-f')
  manifest=$(unzip -p "$out" base/manifest/AndroidManifest.xml | tr -c '[:print:]' '\n')
  if grep -q REQUEST_INSTALL_PACKAGES <<<"$manifest"; then echo "$out asks for the right to install apps: Play refuses it (docs/STORES.md)" >&2; exit 1; fi
  grep -q android.permission.INTERNET <<<"$manifest" || { echo "couldn't read the manifest in $out" >&2; exit 1; }
else
  out=$(ls -t src-tauri/gen/android/app/build/outputs/apk/*/"$mode"/*.apk | head -1)
  bt=$(command ls -1 "$ANDROID_HOME/build-tools" | sort -V | tail -1)
  got=$("$ANDROID_HOME/build-tools/$bt/apksigner" verify --print-certs "$out" | sed -n 's/.*SHA-256 digest: //p' | head -1)
fi
[ -n "$want" ] && [ "$got" = "$want" ] || { echo "$out is not signed with the $keyname (got ${got:-none})" >&2; exit 1; }
# each native library loads on phones with 16 KB memory pages (Play requires it of apps targeting Android 15 and later)
objdump=$(ls "$NDK_HOME"/toolchains/llvm/prebuilt/*/bin/llvm-objdump | head -1)
libs=$(mktemp -d) && trap 'rm -rf "$libs"' EXIT
unzip -q -o "$out" '*.so' -d "$libs"
while IFS= read -r so; do
  align=$("$objdump" -p "$so" | awk '/LOAD/ { sub(/2\*\*/, "", $NF); print $NF }' | sort -n | head -1)
  [ "${align:-0}" -ge 14 ] || { echo "${so#"$libs"/} isn't aligned for 16 KB pages (2**${align:-?})" >&2; exit 1; }
done < <(find "$libs" -name '*.so')
echo "$out"
echo "signed with the $keyname ${got:0:16}…"
