#!/usr/bin/env bash
# The Android app on Google's arm64 virtual phone (Cuttlefish, on the Spark: uni-ops android/RUNBOOK.md), driven as a
# person would: the e2e hubs on loopback (e2e/android/world.ts), a debug APK installed on a clean phone, then a walk
# (e2e/android/<walk>.ts) through the app's WebView devtools, with screenshots from the phone itself. Taps are the
# devtools' own input events, which the WebView takes as a person's (a picker opens on one).
#   scripts/android-drive.sh <debug.apk> <walk> [<folder>]      e.g. scripts/android-drive.sh app-universal-debug.apk libfirst shots
# DRIVE_PORTS: more of the host's loopback ports the phone reaches, as <phone port>:<host port>[,…] (a relay, or a
# pass-through in front of it the walk can cut: e2e/android/unsent.ts).
# Needs PARACHUTE_CORE (a parachute-core binary), podman with the uni-cuttlefish image and the images in
# ~/Android/cuttlefish/run (RUNBOOK.md, "Emulator"), and spark-ai. Exit status: the walk's.
set -euo pipefail
apk=$(realpath "${1:?a debug APK (scripts/android-build.sh --debug): only a debug build opens its WebView to devtools}")
walk=${2:?the walk: e2e/android/<walk>.ts}
root=$(cd "$(dirname "$0")/.." && pwd)
out=$(mkdir -p "${3:-android-drive}" && cd "${3:-android-drive}" && pwd)
: "${PARACHUTE_CORE:?set PARACHUTE_CORE to a parachute-core binary}"
cf=${CF_RUN:-$HOME/Android/cuttlefish/run}
[ -f "$cf/super.img" ] && [ -x "$cf/bin/launch_cvd" ] || { echo "no Cuttlefish images at $cf (uni-ops android/RUNBOOK.md)" >&2; exit 1; }
name=${DRIVE_NAME:-parachute-drive-$$}
CDP=${CDP:-$((19000 + $$ % 1000))}
work=$(mktemp -d "${TMPDIR:-/tmp}/android-drive.XXXXXX")
worldpid=""; phonepid=""
cleanup() {
  touch "$work/stop"
  [ -n "$phonepid" ] && { for _ in $(seq 1 60); do kill -0 "$phonepid" 2>/dev/null || break; sleep 1; done; kill "$phonepid" 2>/dev/null || true; }
  [ -n "$worldpid" ] && kill "$worldpid" 2>/dev/null && wait "$worldpid" 2>/dev/null || true
  cp "$work/logcat.txt" "$out/logcat.txt" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
exec 8>"$cf/.try-apk.lock"; flock -n 8 || { echo "another Cuttlefish run is using $cf" >&2; exit 1; }

echo "== the hubs"
(cd "$root" && exec npx vite-node e2e/android/world.ts "$work/world.json") > "$out/world.log" 2>&1 &
worldpid=$!
for _ in $(seq 1 120); do [ -s "$work/world.json" ] && break; kill -0 "$worldpid" 2>/dev/null || { cat "$out/world.log" >&2; exit 1; }; sleep 1; done
ports=${DRIVE_PORTS:-}
hubport=$(node -e 'console.log(new URL(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).hub).port)' "$work/world.json")

echo "== the phone (hub on $hubport, devtools on 127.0.0.1:$CDP)"
cp "$apk" "$work/app.apk"
cat >"$work/relay.py" <<'PY'
# devtools: adb's forward listens on the container's loopback, which the inbound port doesn't reach; pass it on
import os, socket, threading
def pipe(a, b):
    try:
        while (d := a.recv(65536)): b.sendall(d)
    except OSError: pass
    finally:
        for s in (a, b):
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass
port = int(os.environ["CDP"]); srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("0.0.0.0", port)); srv.listen(16)
while True:
    c, _ = srv.accept(); u = socket.create_connection(("127.0.0.1", port - 1))
    threading.Thread(target=pipe, args=(c, u), daemon=True).start(); threading.Thread(target=pipe, args=(u, c), daemon=True).start()
PY
cat >"$work/inside.sh" <<'IN'
set -euo pipefail
/etc/init.d/cuttlefish-host-resources start >/dev/null 2>&1 || true
cd /cf; export HOME=/cf
adb="/cf/bin/adb -s 127.0.0.1:6520"
bin/launch_cvd --daemon --resume=false --report_anonymous_usage_stats=n --cpus 4 --memory_mb 4096 --gpu_mode guest_swiftshader >/work/launch.log 2>&1 || { tail -40 /work/launch.log; exit 1; }
/cf/bin/adb connect 127.0.0.1:6520 >/dev/null
timeout 300 $adb wait-for-device
for i in $(seq 1 150); do [ "$($adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break; sleep 2; done
$adb shell input keyevent KEYCODE_WAKEUP; $adb shell wm dismiss-keyguard || true
$adb shell settings put system screen_off_timeout 1800000 || true
$adb install -r /work/app.apk >/dev/null
$adb reverse tcp:$HUBPORT tcp:$HUBPORT >/dev/null
for m in ${PORTS//,/ }; do $adb reverse tcp:${m%%:*} tcp:${m%%:*} >/dev/null; done
$adb shell monkey -p computer.parachute.app -c android.intent.category.LAUNCHER 1 >/dev/null
pid=
for i in $(seq 1 90); do pid=$($adb shell pidof computer.parachute.app 2>/dev/null | tr -d '\r' || true); { [ -n "$pid" ] && $adb shell cat /proc/net/unix 2>/dev/null | grep -q "webview_devtools_remote_$pid"; } && break; sleep 1; done
$adb forward tcp:$((CDP-1)) localabstract:webview_devtools_remote_$pid >/dev/null
nohup python3 /work/relay.py > /work/relay.log 2>&1 &
echo "$pid" > /work/ready
# the walk asks through files: a screenshot (shot), a shell command on the phone's side (cmd)
while [ ! -f /work/stop ]; do
  [ -f /work/shot ] && { $adb exec-out screencap -p > /work/shot.png.part && mv /work/shot.png.part /work/shot.png; rm -f /work/shot; }
  if [ -f /work/cmd ]; then ADB="$adb" sh /work/cmd > /work/cmd.out.part 2>&1 || true; mv /work/cmd.out.part /work/cmd.out; rm -f /work/cmd; fi
  sleep 0.3
done
$adb logcat -d -t 2000 >/work/logcat.txt 2>&1 || true
bin/stop_cvd >/dev/null 2>&1 || true
IN
spark-ai lease --gb 8 --name "$name" -- \
  podman run --rm --name "$name" --label owner=uni-cf --label task=parachute-drive \
    --network "pasta:-T,$hubport${ports:+,-T,${ports//,/,-T,}},-t,127.0.0.1/$CDP" \
    --device /dev/kvm --device /dev/vhost-net --device /dev/vhost-vsock --device /dev/net/tun --cap-add NET_ADMIN --cap-add NET_RAW \
    -v "$cf:/cf" -v "$work:/work" -e HUBPORT="$hubport" -e PORTS="$ports" -e CDP="$CDP" localhost/uni-cuttlefish bash /work/inside.sh > "$out/phone.log" 2>&1 &
phonepid=$!
for _ in $(seq 1 600); do [ -s "$work/ready" ] && break; kill -0 "$phonepid" 2>/dev/null || { cat "$out/phone.log" >&2; exit 1; }; sleep 1; done
[ -s "$work/ready" ] || { echo "the phone didn't come up" >&2; exit 1; }

echo "== the walk: $walk"
cd "$root"
CDP=$CDP DRIVE_WORK="$work" DRIVE_OUT="$out" npx vite-node "e2e/android/$walk.ts" "$work/world.json"
