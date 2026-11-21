#!/usr/bin/env bash
# Builds the Buzz relay our production runs, once, and prints its image name: upstream Buzz at BASE with our voice patches
# (relay/voice.patch: audio-only Opus/WebM voice notes, per-kind duration limits, an audio's length). Stock Buzz answers a
# voice note with 415, so rooms.spec and devices.spec need these. A cold build takes 10 to 25 minutes; CI keeps the image
# in its cache (.github/workflows/services.yml). Move BASE and the patch together, to what production runs.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE=95dd9d67dd943cd30fd02dee8e5c11d13639d2ad
TAG="parachute-e2e-buzz:${BASE:0:12}-$(sha256sum "$HERE/relay/voice.patch" | cut -c1-12)"
if docker image inspect "$TAG" >/dev/null 2>&1; then echo "$TAG"; exit 0; fi
SRC="$(mktemp -d)"
trap 'rm -rf "$SRC"' EXIT
git -C "$SRC" init -q
git -C "$SRC" fetch -q --depth 1 https://github.com/block/buzz.git "$BASE"
git -C "$SRC" checkout -q FETCH_HEAD
git -C "$SRC" apply "$HERE/relay/voice.patch"
docker build --load -t "$TAG" "$SRC" >&2
echo "$TAG"
